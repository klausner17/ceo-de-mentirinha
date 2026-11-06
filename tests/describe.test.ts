import { describe, expect, it } from 'vitest'
import type { SessionState } from '../src/shared/types'
import { ago, deskLine, modelName, roomPeople, sessionDetails, sessionTitle, tokens } from '../src/renderer/src/describe'

const NOW = Date.parse('2026-11-06T15:00:00.000Z')
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: '11111111-2222-4333-8444-555555555555',
  cwd: '/Users/ceo/code/loja',
  project: 'loja',
  branch: 'feat/cupom',
  model: 'claude-sonnet-5-5',
  seniority: 'pleno',
  title: 'Cupom de desconto',
  lastPrompt: 'Adiciona cupom de desconto no carrinho',
  startedAt: NOW - 40 * 60_000,
  contextTokens: 120_000,
  contextLimit: 200_000,
  outputTokens: 12_400,
  cacheReadTokens: 0,
  currentTool: { id: 't', name: 'Edit', startedAt: NOW - 2 * 60_000 },
  lastActivity: NOW,
  lastErrorAt: null,
  status: 'trabalhando',
  mcpCalls: [],
  mcpResults: [],
  running: true,
  subagents: [],
  ...over
})

describe('frases da mesa', () => {
  it('formata tempo, tokens e modelo', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('agora mesmo')
    expect(ago(NOW - 12 * 60_000, NOW)).toBe('há 12 min')
    expect(ago(NOW - 130 * 60_000, NOW)).toBe('há 2 h 10 min')
    expect(tokens(850)).toBe('850')
    expect(tokens(120_400)).toBe('120 mil')
    expect(tokens(1_200_000)).toBe('1,2 milhão')
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName(null)).toBe('modelo desconhecido')
  })

  it('trabalhando mostra o pedido; parado mostra há quanto tempo espera', () => {
    expect(deskLine(session(), NOW)).toBe('“Adiciona cupom de desconto no carrinho”')
    const idle = session({ status: 'ocioso', currentTool: null, lastActivity: NOW - 12 * 60_000 })
    expect(deskLine(idle, NOW)).toBe('Esperando você há 12 min')
    expect(deskLine(session({ lastPrompt: null, currentTool: null }), NOW)).toBe('Pensando…')
  })

  it('sem nome usa um apelido curto da sessão', () => {
    expect(sessionTitle(session({ title: null }))).toBe('Sessão 11111111')
  })

  it('conta as pessoas do cômodo em frase', () => {
    expect(roomPeople([session()])).toBe('1 pessoa trabalhando')
    expect(roomPeople([session(), session({ status: 'ocioso' })])).toBe('1 de 2 pessoas trabalhando')
    expect(roomPeople([session({ status: 'ocioso' }), session({ status: 'ocioso' })])).toBe('2 pessoas esperando')
  })

  it('o painel traz o que está fazendo, o pedido e os números', () => {
    const rows = Object.fromEntries(sessionDetails(session(), NOW).map((r) => [r.label, r.value]))
    expect(rows).toMatchObject({
      Agora: 'Escrevendo há 2 min',
      'Último pedido': 'Adiciona cupom de desconto no carrinho',
      'Quem é': 'Pleno · Sonnet 5.5',
      Contexto: '120 mil de 200 mil tokens (60%)',
      Escreveu: '12 mil tokens',
      Chegou: 'há 40 min'
    })
    expect(rows['Último erro']).toBeUndefined()
  })
})
