// Sessões falsas para o modo demo (CEO_DEMO=1). A cada passo algo muda, para mostrar
// as animações das fases 4 e 5 sem precisar de Claude Code rodando.

import type { SessionState, SubagentState, ToolInUse } from '@shared/types'

const tool = (name: string, now: number): ToolInUse => ({ id: `${name}-${now}`, name, startedAt: now })
const sub = (id: string, agentType: string, model: string, working: boolean, now: number): SubagentState => ({
  id,
  agentType,
  model,
  currentTool: working ? tool('Grep', now) : null,
  lastActivity: now,
  lastErrorAt: null,
  finished: false
})

const DIRECTOR_TOOLS = ['Edit', 'Read', 'Agent', 'Bash', 'Grep', 'TodoWrite', 'WebSearch', 'mcp__jira__search']
const PLENO_TOOLS = ['Bash', 'Bash', 'Read', 'Edit']

/** Estado das sessões falsas no passo `step` (um passo a cada poucos segundos). */
export function demoSessions(now: number, step = 0, start = now): SessionState[] {
  const base = { outputTokens: 12_000, cacheReadTokens: 400_000, running: true, contextLimit: 200_000, lastErrorAt: null }
  // Os liderados chegam no passo 2 e vão embora no passo 7 de cada ciclo de 10.
  const cycle = step % 10
  const team = cycle >= 2 && cycle < 7 ? [sub('a1', 'Explore', 'claude-haiku-5-5', true, now), sub('a2', 'general-purpose', 'claude-sonnet-5-5', cycle % 2 === 0, now)] : []
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
      contextTokens: 120_000 + (step % 5) * 15_000,
      currentTool: tool(DIRECTOR_TOOLS[step % DIRECTOR_TOOLS.length]!, now),
      lastActivity: now,
      status: 'trabalhando',
      subagents: team
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
      currentTool: tool(PLENO_TOOLS[step % PLENO_TOOLS.length]!, now),
      // Um teste falha a cada ciclo: papel amassado e fumaça.
      lastErrorAt: cycle >= 4 ? start + (step - cycle + 4) * 3000 : null,
      lastActivity: now,
      status: 'trabalhando',
      subagents: []
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
      status: 'ocioso',
      subagents: []
    }
  ]
}
