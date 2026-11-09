// Acumula os eventos de UM transcript (sessão principal ou subagente).
// Não conhece arquivos nem relógio: recebe eventos e devolve números.

import { parseMcpTool } from '@shared/mcp'
import type { McpCall, McpResult, ToolInUse } from '@shared/types'
export { seniorityFor } from '@shared/seniority'
import { DeliverablesTracker } from './deliverables'
import type { TitleSource, ToolInput, TranscriptEvent } from './parser'

export class AgentTracker {
  cwd: string | null = null
  branch: string | null = null
  model: string | null = null
  /** Nomes da sessão por origem (ver TitleSource no parser). */
  readonly titles: Partial<Record<TitleSource, string>> = {}
  /** Primeiro e último pedido digitados pela pessoa. */
  firstPrompt: string | null = null
  lastPrompt: string | null = null
  /** Horário da primeira linha com timestamp: quando a sessão começou. */
  startedAt = 0
  contextTokens = 0
  outputTokens = 0
  cacheReadTokens = 0
  lastActivity = 0
  lastStopReason: string | null = null
  lastErrorAt: number | null = null

  /** message.id já contabilizados: uma resposta vira várias linhas com o mesmo usage. */
  private readonly countedMessages = new Set<string>()
  /** tool_use sem tool_result, na ordem em que apareceram. */
  private readonly pending = new Map<string, ToolInUse>()
  /** Input das ferramentas pendentes: diz o que virou entrega quando o resultado chega. */
  private readonly inputs = new Map<string, ToolInput>()
  /** PRs, commits, arquivos e artefatos produzidos por este transcript. */
  readonly deliverables = new DeliverablesTracker()
  /** Últimas chamadas MCP terminadas (as mais recentes no fim). */
  private readonly mcpDone: McpResult[] = []

  /** Aplica um evento. Retorna true se algo visível mudou. */
  apply(ev: TranscriptEvent): boolean {
    let changed = false
    const set = <K extends 'cwd' | 'branch' | 'model'>(key: K, value: this[K] | null): void => {
      if (value !== null && this[key] !== value) {
        this[key] = value as this[K]
        changed = true
      }
    }

    set('cwd', ev.cwd)
    set('branch', ev.branch)
    if (ev.timestamp !== null && (this.startedAt === 0 || ev.timestamp < this.startedAt)) this.startedAt = ev.timestamp
    if (ev.timestamp !== null && ev.timestamp > this.lastActivity) {
      this.lastActivity = ev.timestamp
      changed = true
    }

    switch (ev.kind) {
      case 'title':
        if (this.titles[ev.source] !== ev.title) {
          this.titles[ev.source] = ev.title
          changed = true
        }
        break

      case 'assistant': {
        // "<synthetic>" aparece em mensagens geradas localmente (erros, interrupções).
        if (ev.model && ev.model !== '<synthetic>') set('model', ev.model)
        const fresh = ev.messageId === null || !this.countedMessages.has(ev.messageId)
        if (ev.usage && fresh) {
          if (ev.messageId) this.countedMessages.add(ev.messageId)
          const u = ev.usage
          this.contextTokens = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens
          this.outputTokens += u.outputTokens
          this.cacheReadTokens += u.cacheReadTokens
          changed = true
        }
        for (const t of ev.toolUses) {
          if (!this.pending.has(t.id)) {
            this.pending.set(t.id, { id: t.id, name: t.name, startedAt: ev.timestamp ?? this.lastActivity })
            this.inputs.set(t.id, t.input)
            changed = true
          }
        }
        if (ev.stopReason !== null && ev.stopReason !== this.lastStopReason) {
          this.lastStopReason = ev.stopReason
          changed = true
        }
        break
      }

      case 'user':
        if (ev.prompt !== null) {
          this.firstPrompt ??= ev.prompt
          if (this.lastPrompt !== ev.prompt) {
            this.lastPrompt = ev.prompt
            changed = true
          }
        }
        for (const r of ev.toolResults) {
          const call = this.pending.get(r.toolUseId)
          if (call) {
            this.pending.delete(r.toolUseId)
            const input = this.inputs.get(r.toolUseId)
            this.inputs.delete(r.toolUseId)
            if (input) this.deliverables.toolDone({ name: call.name, input }, r, ev.timestamp ?? this.lastActivity)
            changed = true
            const mcp = parseMcpTool(call.name)
            if (mcp) {
              this.mcpDone.push({ id: call.id, server: mcp.server, ok: !r.isError, at: ev.timestamp ?? this.lastActivity })
              if (this.mcpDone.length > 20) this.mcpDone.shift()
            }
          }
          if (r.isError) {
            this.lastErrorAt = ev.timestamp ?? this.lastActivity
            changed = true
          }
        }
        break

      case 'pr-link':
        if (this.deliverables.linkPr(ev, ev.timestamp ?? this.lastActivity)) changed = true
        break

      case 'other':
        break
    }
    return changed
  }

  /** Melhor nome vindo do transcript: o que a pessoa deu, depois o gerado. */
  get title(): string | null {
    const t = this.titles
    return t.custom ?? t.agent ?? t.ai ?? t.summary ?? null
  }

  /** A ferramenta mais recente ainda sem resultado. */
  get currentTool(): ToolInUse | null {
    let last: ToolInUse | null = null
    for (const t of this.pending.values()) last = t
    return last
  }

  /** Chamadas MCP ainda sem resultado. */
  get mcpCalls(): McpCall[] {
    const out: McpCall[] = []
    for (const t of this.pending.values()) {
      const mcp = parseMcpTool(t.name)
      if (mcp) out.push({ id: t.id, server: mcp.server, tool: mcp.tool, startedAt: t.startedAt })
    }
    return out
  }

  /** Chamadas MCP terminadas desde `since`. */
  mcpResultsSince(since: number): McpResult[] {
    return this.mcpDone.filter((r) => r.at >= since)
  }

  get pendingCount(): number {
    return this.pending.size
  }

  /** O turno terminou: resposta final sem tool call pendente. */
  get turnFinished(): boolean {
    return this.pending.size === 0 && this.lastStopReason === 'end_turn'
  }
}
