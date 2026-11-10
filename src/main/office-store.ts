// Estado de todas as sessões. Recebe linhas e registros, decide quem está no
// escritório e emite só o que mudou. Não toca em arquivos: o watcher alimenta.

import type { Awaiting, OfficeDelta, SessionState, SubagentState } from '@shared/types'
import { AgentTracker, seniorityFor } from './agent-tracker'
import { mergeDeliverables } from './deliverables'
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
  /** Por quanto tempo um resultado MCP continua visível (office boy voltando). */
  mcpResultMs: number
  /** Verifica se um pid está vivo. Injetável para os testes. */
  isAlive: (pid: number) => boolean
}

export const defaultOptions: StoreOptions = {
  idleMs: Number(process.env.CEO_IDLE_MINUTES ?? 5) * 60_000,
  goneMs: 30 * 60_000,
  goneWithRegistryMs: 2 * 60_000,
  subagentGoneMs: 10 * 60_000,
  mcpResultMs: 30_000,
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
  /** Origem do nome: `user`, `peer`, `hook`, `auto`, `derived` (pasta + número), `collision`. */
  nameSource: string | null
  /** `busy` durante um turno, `idle` esperando o próximo pedido, `waiting` esperando a pessoa. */
  status: string | null
  /** Com `status: "waiting"`: `permission prompt`, `input needed`, `dialog open`… */
  waitingFor: string | null
  /** Quando o status mudou (epoch em ms). */
  statusUpdatedAt: number | null
}

/** Nomes do registro de processos que alguém escolheu de propósito. */
const CHOSEN_NAMES = new Set(['user', 'peer', 'hook'])
/** Tamanho máximo do primeiro pedido quando ele vira o nome da mesa. */
const PROMPT_NAME_MAX = 48

/**
 * O nome da sessão como a pessoa a reconhece: o nome que ela deu (/rename ou registro),
 * depois o título gerado pelo Claude Code, depois o primeiro pedido e, por último, o nome
 * derivado da pasta (ex.: "loja-1"), que diz pouco.
 */
export function sessionName(main: AgentTracker, reg: Pick<RegistryEntry, 'name' | 'nameSource'> | null): string | null {
  const t = main.titles
  const regName = reg?.name ?? null
  const chosen = regName && reg?.nameSource && CHOSEN_NAMES.has(reg.nameSource) ? regName : null
  const auto = regName && reg?.nameSource === 'auto' ? regName : null
  const prompt = main.firstPrompt
  const fromPrompt = prompt && (prompt.length > PROMPT_NAME_MAX ? `${prompt.slice(0, PROMPT_NAME_MAX - 1).trimEnd()}…` : prompt)
  return t.custom ?? chosen ?? t.agent ?? t.ai ?? t.summary ?? auto ?? fromPrompt ?? regName ?? null
}

/** Ferramentas que são uma pergunta para a pessoa, e não trabalho. */
const QUESTION_TOOLS = new Set(['AskUserQuestion'])
/** Ferramentas de delegação: a permissão pedida costuma ser de um subagente. */
const DELEGATION_TOOLS = new Set(['Agent', 'Task'])

/**
 * Se a sessão está esperando o CEO, e por quê. O sinal mais confiável é o registro de
 * processos (`status: "waiting"` aparece nos pedidos de permissão, perguntas e diálogos,
 * a partir do 2.1.319). Sem ele, só dá para ver pelo transcript as perguntas
 * (AskUserQuestion) e o fim do turno; um pedido de permissão parece uma ferramenta lenta.
 */
export function awaitingFor(
  main: AgentTracker,
  reg: Pick<RegistryEntry, 'status' | 'waitingFor' | 'statusUpdatedAt'> | null,
  subagents: SubagentState[]
): Awaiting | null {
  const status = reg?.status ?? null
  const tool = main.currentTool
  // O transcript não muda enquanto espera, então a última linha identifica o email.
  const since = main.lastActivity || (reg?.statusUpdatedAt ?? 0)
  if (status === 'waiting') {
    if (tool && QUESTION_TOOLS.has(tool.name)) return { reason: 'pergunta', since, detail: null }
    if (reg?.waitingFor === 'permission prompt' || (reg?.waitingFor === null && tool)) {
      const fromSub = tool && DELEGATION_TOOLS.has(tool.name) ? subagents.find((a) => a.currentTool)?.currentTool : null
      return { reason: 'permissao', since, detail: (fromSub ?? tool)?.name ?? null }
    }
    return { reason: 'pergunta', since, detail: reg?.waitingFor ?? null }
  }
  if (status !== null && status !== 'idle') return null
  if (status === null && tool && QUESTION_TOOLS.has(tool.name)) return { reason: 'pergunta', since, detail: null }
  if (main.turnFinished && subagents.length === 0 && since > 0) return { reason: 'relatorio', since, detail: null }
  return null
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
      this.registry.set(pid, {
        pid,
        sessionId: s(r.sessionId),
        cwd: s(r.cwd),
        name: s(r.name),
        nameSource: s(r.nameSource),
        status: s(r.status),
        waitingFor: s(r.waitingFor),
        statusUpdatedAt: typeof r.statusUpdatedAt === 'number' ? r.statusUpdatedAt : null
      })
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
        lastErrorAt: t.lastErrorAt,
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
      title: sessionName(main, reg),
      lastPrompt: main.lastPrompt,
      startedAt: main.startedAt || null,
      contextTokens: main.contextTokens,
      contextLimit: main.contextTokens > 200_000 ? 1_000_000 : 200_000,
      outputTokens: main.outputTokens,
      cacheReadTokens: main.cacheReadTokens,
      currentTool: main.currentTool,
      lastActivity: main.lastActivity,
      lastErrorAt: main.lastErrorAt,
      status: busy ? 'trabalhando' : 'ocioso',
      mcpCalls: main.mcpCalls,
      mcpResults: main.mcpResultsSince(now - this.opts.mcpResultMs),
      running,
      awaiting: awaitingFor(main, reg, subagents),
      subagents,
      // Ajudantes que já terminaram (e saíram da mesa) continuam contando.
      deliverables: mergeDeliverables([main.deliverables, ...[...rec.subagents.values()].map((a) => a.tracker.deliverables)])
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
