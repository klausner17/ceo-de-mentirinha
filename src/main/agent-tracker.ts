// Acumula os eventos de UM transcript (sessão principal ou subagente).
// Não conhece arquivos nem relógio: recebe eventos e devolve números.

import type { Seniority, ToolInUse } from '@shared/types'
import type { TranscriptEvent } from './parser'

export function seniorityFor(model: string | null): Seniority {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus')) return 'diretor'
  if (m.includes('sonnet')) return 'pleno'
  if (m.includes('haiku')) return 'junior'
  return 'desconhecido'
}

export class AgentTracker {
  cwd: string | null = null
  branch: string | null = null
  model: string | null = null
  title: string | null = null
  contextTokens = 0
  outputTokens = 0
  cacheReadTokens = 0
  lastActivity = 0
  lastStopReason: string | null = null

  /** message.id já contabilizados: uma resposta vira várias linhas com o mesmo usage. */
  private readonly countedMessages = new Set<string>()
  /** tool_use sem tool_result, na ordem em que apareceram. */
  private readonly pending = new Map<string, ToolInUse>()

  /** Aplica um evento. Retorna true se algo visível mudou. */
  apply(ev: TranscriptEvent): boolean {
    let changed = false
    const set = <K extends 'cwd' | 'branch' | 'model' | 'title'>(key: K, value: this[K] | null): void => {
      if (value !== null && this[key] !== value) {
        this[key] = value as this[K]
        changed = true
      }
    }

    set('cwd', ev.cwd)
    set('branch', ev.branch)
    if (ev.timestamp !== null && ev.timestamp > this.lastActivity) {
      this.lastActivity = ev.timestamp
      changed = true
    }

    switch (ev.kind) {
      case 'title':
        set('title', ev.title)
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
        for (const r of ev.toolResults) {
          if (this.pending.delete(r.toolUseId)) changed = true
        }
        break

      case 'other':
        break
    }
    return changed
  }

  /** A ferramenta mais recente ainda sem resultado. */
  get currentTool(): ToolInUse | null {
    let last: ToolInUse | null = null
    for (const t of this.pending.values()) last = t
    return last
  }

  get pendingCount(): number {
    return this.pending.size
  }

  /** O turno terminou: resposta final sem tool call pendente. */
  get turnFinished(): boolean {
    return this.pending.size === 0 && this.lastStopReason === 'end_turn'
  }
}
