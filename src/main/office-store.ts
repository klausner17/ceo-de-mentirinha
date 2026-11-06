// Estado de todas as sessões. Recebe linhas e registros, decide quem está no
// escritório e emite só o que mudou. Não toca em arquivos: o watcher alimenta.

import type { OfficeDelta, SessionState, SubagentState } from '@shared/types'
import { AgentTracker, seniorityFor } from './agent-tracker'
import { parseLine, type TranscriptEvent } from './parser'
import { projectName } from './paths'

export interface StoreOptions {
  /** Sem escrita há este tempo = ocioso (cochilando). */
  idleMs: number
  /** Sem registro de processo e sem escrita há este tempo = foi embora. */
  goneMs: number
  /** Quando existe registro de processos, uma sessão fora dele some mais rápido. */
  goneWithRegistryMs: number
  /** Subagente sem escrita há este tempo some, mesmo sem ter terminado. */
  subagentGoneMs: number
  /** Verifica se um pid está vivo. Injetável para os testes. */
  isAlive: (pid: number) => boolean
}

export const defaultOptions: StoreOptions = {
  idleMs: Number(process.env.CEO_IDLE_MINUTES ?? 5) * 60_000,
  goneMs: 30 * 60_000,
  goneWithRegistryMs: 2 * 60_000,
  subagentGoneMs: 10 * 60_000,
  isAlive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      // EPERM: o processo existe, só não é nosso.
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
}

interface RegistryEntry {
  pid: number
  sessionId: string | null
  cwd: string | null
  name: string | null
  status: string | null
}

interface SessionRecord {
  main: AgentTracker
  subagents: Map<string, { tracker: AgentTracker; agentType: string | null }>
}

export class OfficeStore {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly registry = new Map<number, RegistryEntry>()
  private registrySeen = false
  /** Último estado enviado ao renderer, por sessão. */
  private readonly emitted = new Map<string, string>()
  private readonly listeners = new Set<(d: OfficeDelta) => void>()
  private readonly opts: StoreOptions

  constructor(opts: Partial<StoreOptions> = {}) {
    this.opts = { ...defaultOptions, ...opts }
  }

  onDelta(listener: (d: OfficeDelta) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(d: OfficeDelta): void {
    for (const l of this.listeners) l(d)
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ kind: 'log', level, message, at: Date.now() })
  }

  private record(sessionId: string): SessionRecord {
    let rec = this.sessions.get(sessionId)
    if (!rec) {
      rec = { main: new AgentTracker(), subagents: new Map() }
      this.sessions.set(sessionId, rec)
    }
    return rec
  }

  private subagent(rec: SessionRecord, agentId: string) {
    let sub = rec.subagents.get(agentId)
    if (!sub) {
      sub = { tracker: new AgentTracker(), agentType: null }
      rec.subagents.set(agentId, sub)
    }
    return sub
  }

  /** Linhas novas do transcript principal de uma sessão. */
  ingestSession(sessionId: string, lines: string[]): void {
    const rec = this.record(sessionId)
    for (const line of lines) {
      const ev = parseLine(line)
      // Versões antigas misturam linhas de subagente no arquivo do pai: ficam de fora da mesa principal.
      if (ev && !ev.isSidechain) rec.main.apply(ev)
    }
  }

  /**
   * Linhas novas do transcript de um subagente. Em versões antigas o pai não
   * vem do caminho (`sessionId` null) e é lido do campo sessionId das linhas.
   */
  ingestSubagent(sessionId: string | null, agentId: string, lines: string[]): void {
    for (const line of lines) {
      const ev: TranscriptEvent | null = parseLine(line)
      const parent = sessionId ?? ev?.sessionId
      if (!ev || !parent) continue
      this.subagent(this.record(parent), agentId).tracker.apply(ev)
    }
  }

  setSubagentMeta(sessionId: string, agentId: string, json: string): void {
    try {
      const meta = JSON.parse(json) as Record<string, unknown>
      const type = meta.agentType ?? meta.subagent_type ?? meta.type
      this.subagent(this.record(sessionId), agentId).agentType = typeof type === 'string' ? type : null
    } catch {
      // meta.json incompleto: tenta de novo na próxima mudança.
    }
  }

  setRegistry(pid: number, json: string | null): void {
    if (json === null) {
      this.registry.delete(pid)
      return
    }
    try {
      const r = JSON.parse(json) as Record<string, unknown>
      const s = (v: unknown) => (typeof v === 'string' ? v : null)
      this.registry.set(pid, { pid, sessionId: s(r.sessionId), cwd: s(r.cwd), name: s(r.name), status: s(r.status) })
      this.registrySeen = true
    } catch {
      // Arquivo sendo escrito: ignora até a próxima mudança.
    }
  }

  private registryFor(sessionId: string): RegistryEntry | null {
    for (const r of this.registry.values()) {
      if (r.sessionId === sessionId && this.opts.isAlive(r.pid)) return r
    }
    return null
  }

  /** Monta o estado de uma sessão, ou null se ela não deve aparecer no escritório. */
  private build(sessionId: string, rec: SessionRecord, now: number): SessionState | null {
    const main = rec.main
    const reg = this.registryFor(sessionId)
    const running = reg !== null
    if (main.lastActivity === 0 && !running) return null

    const quiet = now - main.lastActivity
    const goneAfter = this.registrySeen ? this.opts.goneWithRegistryMs : this.opts.goneMs
    if (!running && quiet > goneAfter) return null

    const subagents: SubagentState[] = []
    for (const [id, sub] of rec.subagents) {
      const t = sub.tracker
      if (t.turnFinished || now - t.lastActivity > this.opts.subagentGoneMs) continue
      subagents.push({
        id,
        agentType: sub.agentType,
        model: t.model,
        currentTool: t.currentTool,
        lastActivity: t.lastActivity,
        finished: false
      })
    }
    subagents.sort((a, b) => a.id.localeCompare(b.id))

    const cwd = main.cwd ?? reg?.cwd ?? null
    const busy = main.currentTool !== null || subagents.length > 0 || quiet < this.opts.idleMs
    return {
      id: sessionId,
      cwd,
      project: projectName(cwd),
      branch: main.branch,
      model: main.model,
      seniority: seniorityFor(main.model),
      title: main.title ?? reg?.name ?? null,
      contextTokens: main.contextTokens,
      outputTokens: main.outputTokens,
      cacheReadTokens: main.cacheReadTokens,
      currentTool: main.currentTool,
      lastActivity: main.lastActivity,
      status: busy ? 'trabalhando' : 'ocioso',
      running,
      subagents
    }
  }

  /** Estado atual de todas as sessões visíveis. */
  snapshot(now = Date.now()): SessionState[] {
    const out: SessionState[] = []
    for (const [id, rec] of this.sessions) {
      const s = this.build(id, rec, now)
      if (s) out.push(s)
    }
    // Sessões que só existem no registro (ainda sem transcript).
    for (const r of this.registry.values()) {
      if (r.sessionId && !this.sessions.has(r.sessionId)) {
        const s = this.build(r.sessionId, { main: new AgentTracker(), subagents: new Map() }, now)
        if (s) out.push(s)
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  /** Recalcula tudo e emite upsert/remove só do que mudou desde a última vez. */
  flush(now = Date.now()): void {
    const current = new Map(this.snapshot(now).map((s) => [s.id, s]))
    for (const [id, s] of current) {
      const json = JSON.stringify(s)
      if (this.emitted.get(id) !== json) {
        this.emitted.set(id, json)
        this.emit({ kind: 'upsert', session: s })
      }
    }
    for (const id of [...this.emitted.keys()]) {
      if (!current.has(id)) {
        this.emitted.delete(id)
        this.emit({ kind: 'remove', id })
      }
    }
  }
}
