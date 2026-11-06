// Sessões falsas para o modo demo (CEO_DEMO=1) e para testar o renderer.

import type { SessionState } from '@shared/types'

export function demoSessions(now: number): SessionState[] {
  const base = {
    outputTokens: 12_000,
    cacheReadTokens: 400_000,
    running: true,
    subagents: []
  }
  return [
    {
      ...base,
      id: 'demo-1',
      cwd: '/Users/ceo/code/loja',
      project: 'loja',
      branch: 'main',
      model: 'claude-opus-5-5',
      seniority: 'diretor',
      title: 'Refatorar checkout',
      contextTokens: 150_000,
      currentTool: { id: 't1', name: 'Edit', startedAt: now },
      lastActivity: now,
      status: 'trabalhando',
      subagents: [
        { id: 'a1', agentType: 'Explore', model: 'claude-haiku-5-5', currentTool: { id: 't2', name: 'Grep', startedAt: now }, lastActivity: now, finished: false },
        { id: 'a2', agentType: 'general-purpose', model: 'claude-sonnet-5-5', currentTool: null, lastActivity: now, finished: false }
      ]
    },
    {
      ...base,
      id: 'demo-2',
      cwd: '/Users/ceo/code/loja',
      project: 'loja',
      branch: 'feat/cupom',
      model: 'claude-sonnet-5-5',
      seniority: 'pleno',
      title: 'Cupom de desconto',
      contextTokens: 40_000,
      currentTool: { id: 't3', name: 'Bash', startedAt: now },
      lastActivity: now,
      status: 'trabalhando'
    },
    {
      ...base,
      id: 'demo-3',
      cwd: '/Users/ceo/code/blog',
      project: 'blog',
      branch: 'main',
      model: 'claude-haiku-5-5',
      seniority: 'junior',
      title: 'Corrigir typos',
      contextTokens: 8_000,
      currentTool: null,
      lastActivity: now - 20 * 60_000,
      status: 'ocioso'
    }
  ]
}
