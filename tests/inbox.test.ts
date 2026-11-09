import { describe, expect, it } from 'vitest'
import type { SessionState } from '../src/shared/types'
import { emailKey, emailSubject, inbox, unreadCount } from '../src/renderer/src/inbox'
import { deskLine } from '../src/renderer/src/describe'

const NOW = Date.parse('2026-11-06T15:00:00.000Z')
const session = (id: string, over: Partial<SessionState> = {}): SessionState => ({
  id,
  cwd: '/Users/ceo/code/loja',
  project: 'loja',
  branch: 'main',
  model: 'claude-sonnet-5-5',
  seniority: 'pleno',
  title: `Sessão ${id}`,
  lastPrompt: 'Adiciona cupom de desconto no carrinho',
  startedAt: NOW - 40 * 60_000,
  contextTokens: 0,
  contextLimit: 200_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  currentTool: null,
  lastActivity: NOW,
  lastErrorAt: null,
  status: 'trabalhando',
  mcpCalls: [],
  mcpResults: [],
  running: true,
  awaiting: null,
  subagents: [],
  deliverables: { prs: [], commits: [], files: [], filesTotal: 0, filesCreated: 0, links: [] },
  ...over
})

describe('caixa de entrada do CEO', () => {
  const perm = session('a', { awaiting: { reason: 'permissao', since: NOW - 60_000, detail: 'Bash' } })
  const done = session('b', { awaiting: { reason: 'relatorio', since: NOW - 5 * 60_000, detail: null } })
  const busy = session('c')

  it('um email por sessão esperando, urgentes primeiro', () => {
    const emails = inbox([done, busy, perm], new Set())
    expect(emails.map((e) => e.sessionId)).toEqual(['a', 'b'])
    expect(unreadCount(emails)).toBe(2)
  })

  it('lidos não contam; email novo da mesma sessão volta a contar', () => {
    const read = new Set([emailKey('a', perm.awaiting!)])
    expect(unreadCount(inbox([perm, done], read))).toBe(1)
    const again = session('a', { awaiting: { reason: 'permissao', since: NOW, detail: 'Edit' } })
    expect(unreadCount(inbox([again, done], read))).toBe(2)
  })

  it('assuntos em português', () => {
    expect(emailSubject(perm, perm.awaiting!)).toBe('Posso usar Bash?')
    expect(emailSubject(perm, { reason: 'permissao', since: 0, detail: 'mcp__jira__get_issue' })).toBe('Posso usar jira › get_issue?')
    expect(emailSubject(perm, { reason: 'permissao', since: 0, detail: 'ExitPlanMode' })).toBe('Aprova o meu plano?')
    expect(emailSubject(perm, { reason: 'pergunta', since: 0, detail: null })).toBe('Tenho uma pergunta para você')
    expect(emailSubject(done, done.awaiting!)).toBe('Terminei: “Adiciona cupom de desconto no carrinho”')
  })

  it('a plaquinha da mesa diz que está esperando o CEO', () => {
    expect(deskLine(perm, NOW)).toBe('Pedindo sua permissão há 1 min')
    expect(deskLine(done, NOW)).toBe('Esperando você há 5 min')
  })
})
