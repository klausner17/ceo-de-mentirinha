// Sessões falsas para o modo demo (CEO_DEMO=1). A cada passo algo muda, para mostrar
// as animações das fases 4 e 5 sem precisar de Claude Code rodando.

import type { Deliverables, McpCall, McpResult, SessionState, SubagentState, ToolInUse } from '@shared/types'

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

/**
 * Office boys do demo: a cada ciclo, dois pedidos ao Jira (formam fila) que voltam com
 * o envelope, e um ao Google Drive que falha.
 */
function demoMcp(step: number, server: string, from: number, to: number, ok: boolean, start: number) {
  const cycle = step % 10
  const id = `${server}-${from}-${Math.floor(step / 10)}`
  const calls: McpCall[] = cycle >= from && cycle < to ? [{ id, server, tool: 'busca', startedAt: start + from * 1000 }] : []
  const results: McpResult[] = cycle >= to ? [{ id, server, ok, at: start + to * 1000 }] : []
  return { calls, results }
}

const nothing: Deliverables = { prs: [], commits: [], files: [], filesTotal: 0, filesCreated: 0, links: [] }

/**
 * Entregas do demo: o diretor já tem um PR e vai fazendo commits; o pleno abre um PR novo
 * no passo 7 de cada ciclo (festa na mesa) e publica um artefato.
 */
function demoDeliverables(step: number, start: number): Record<'diretor' | 'pleno' | 'junior', Deliverables> {
  const cycle = step % 10
  const round = Math.floor(step / 10)
  const at = (s: number) => start + s * 3000
  const dirFiles = ['src/checkout/etapas.ts', 'src/checkout/pagamento.ts', 'src/checkout/entrega.ts', 'tests/checkout.test.ts']
  const files = dirFiles.slice(0, 1 + (step % 4)).map((path, i) => ({ path, created: i < 2, at: at(i) }))
  const plenoPrs = Array.from({ length: Math.min(3, round + (cycle >= 7 ? 1 : 0)) }, (_, i) => {
    const n = 43 + round - (cycle >= 7 ? 0 : 1) - i
    return { number: n, url: `https://github.com/ceo/loja/pull/${n}`, repository: 'ceo/loja', title: n === 43 ? 'Cupom de desconto no carrinho' : `Ajustes no cupom (${n - 43})`, at: at(n) }
  }).reverse()
  return {
    diretor: {
      prs: [{ number: 42, url: 'https://github.com/ceo/loja/pull/42', repository: 'ceo/loja', title: 'Checkout em etapas', at: start - 30 * 60_000 }],
      commits: Array.from({ length: 1 + Math.min(4, Math.floor(step / 3)) }, (_, i) => ({ sha: `a1b2c${i}0`, message: ['Separa o checkout em etapas', 'Etapa de pagamento', 'Etapa de entrega', 'Testes do checkout', 'Ajusta nomes'][i]!, at: at(i * 3) })),
      files,
      filesTotal: files.length,
      filesCreated: files.filter((f) => f.created).length,
      links: []
    },
    pleno: {
      ...nothing,
      prs: plenoPrs,
      commits: plenoPrs.length > 0 ? [{ sha: 'c0ffee1', message: 'Adiciona cupom de desconto', at: at(6) }] : [],
      files: [{ path: 'src/carrinho/cupom.ts', created: true, at: at(1) }],
      filesTotal: 1,
      filesCreated: 1,
      links: [{ url: 'https://claude.ai/artifact/demo-cupom', title: 'Regras do cupom', at: at(2) }]
    },
    junior: { ...nothing, files: [{ path: 'posts/ultimo-post.md', created: false, at: start - 25 * 60_000 }], filesTotal: 1 }
  }
}

/** Estado das sessões falsas no passo `step` (um passo a cada poucos segundos). */
export function demoSessions(now: number, step = 0, start = now): SessionState[] {
  const done = demoDeliverables(step, start)
  const base = { mcpCalls: [], mcpResults: [], outputTokens: 12_000, cacheReadTokens: 400_000, running: true, contextLimit: 200_000, lastErrorAt: null, startedAt: start - 40 * 60_000, awaiting: null }
  // Os liderados chegam no passo 2 e vão embora no passo 7 de cada ciclo de 10.
  const cycle = step % 10
  const jiraA = demoMcp(step, 'jira', 1, 4, true, start)
  const jiraB = demoMcp(step, 'jira', 2, 6, true, start)
  const drive = demoMcp(step, 'claude_ai_Google_Drive', 3, 6, false, start)
  // O pleno pede permissão para rodar um comando no fim de cada ciclo: email no computador do CEO.
  const asking = cycle >= 8
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
      lastPrompt: 'Separa o checkout em etapas e mantém os testes passando',
      contextTokens: 120_000 + (step % 5) * 15_000,
      currentTool: tool(DIRECTOR_TOOLS[step % DIRECTOR_TOOLS.length]!, now),
      lastActivity: now,
      status: 'trabalhando',
      mcpCalls: [...jiraA.calls, ...jiraB.calls],
      mcpResults: [...jiraA.results, ...jiraB.results],
      subagents: team,
      deliverables: done.diretor
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
      lastPrompt: 'Adiciona cupom de desconto no carrinho',
      contextTokens: 40_000,
      currentTool: asking ? { id: `Bash-${step - cycle}`, name: 'Bash', startedAt: start + (step - cycle + 8) * 3000 } : tool(PLENO_TOOLS[step % PLENO_TOOLS.length]!, now),
      awaiting: asking ? { reason: 'permissao', since: start + (step - cycle + 8) * 3000, detail: 'Bash' } : null,
      // Um teste falha a cada ciclo: papel amassado e fumaça.
      lastErrorAt: cycle >= 4 ? start + (step - cycle + 4) * 3000 : null,
      lastActivity: now,
      status: 'trabalhando',
      mcpCalls: drive.calls,
      mcpResults: drive.results,
      subagents: [],
      deliverables: done.pleno
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
      lastPrompt: 'Corrige os erros de digitação do último post',
      contextTokens: 8_000,
      currentTool: null,
      lastActivity: start - 20 * 60_000,
      status: 'ocioso',
      awaiting: { reason: 'relatorio', since: start - 20 * 60_000, detail: null },
      subagents: [],
      deliverables: done.junior
    }
  ]
}
