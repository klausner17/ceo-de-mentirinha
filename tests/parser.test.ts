import { describe, expect, it } from 'vitest'
import { parseLine } from '../src/main/parser'
import { lines } from './helpers'

describe('parseLine', () => {
  const evs = lines('session-2.1.318-tool-pending.jsonl').map(parseLine)

  it('lê cwd, branch e sessionId das linhas', () => {
    const user = evs.find((e) => e?.kind === 'user')!
    expect(user.cwd).toBe('/Users/ceo/code/loja')
    expect(user.branch).toBe('feat/cupom')
    expect(user.sessionId).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('extrai modelo, usage e tool_use das respostas', () => {
    const withTool = evs.find((e) => e?.kind === 'assistant' && e.toolUses.length > 0)
    expect(withTool).toMatchObject({
      kind: 'assistant',
      model: 'claude-sonnet-5-5',
      messageId: 'msg_A',
      toolUses: [{ id: 'toolu_1', name: 'Read' }],
      usage: { inputTokens: 2, cacheReadTokens: 30000, cacheCreationTokens: 5000, outputTokens: 120 }
    })
  })

  it('extrai tool_result e título', () => {
    expect(evs.find((e) => e?.kind === 'user' && e.toolResults.length > 0)).toMatchObject({
      toolResults: [{ toolUseId: 'toolu_1', isError: false }]
    })
    expect(evs.find((e) => e?.kind === 'title')).toMatchObject({ title: 'Cupom de desconto' })
  })

  it('não quebra com JSON inválido nem com tipos desconhecidos', () => {
    expect(parseLine('{"type":"assistant", INVALIDO')).toBeNull()
    expect(parseLine('')).toBeNull()
    expect(parseLine('42')).toBeNull()
    expect(parseLine('{"type":"formato-futuro"}')).toMatchObject({ kind: 'other', type: 'formato-futuro' })
  })

  it('marca linhas de subagente (sidechain)', () => {
    expect(evs.at(-1)).toMatchObject({ isSidechain: true })
  })
})
