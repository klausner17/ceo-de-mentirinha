import { describe, expect, it } from 'vitest'
import { AgentTracker } from '../src/main/agent-tracker'
import { OfficeStore, sessionName } from '../src/main/office-store'
import { parseLine, type TranscriptEvent } from '../src/main/parser'
import { lines, SESSION, T0 } from './helpers'

const FIXTURE = 'session-2.1.319-nomes.jsonl'
const tracker = (raw: string[]) => {
  const t = new AgentTracker()
  for (const l of raw) {
    const ev = parseLine(l)
    if (ev) t.apply(ev)
  }
  return t
}

describe('nome real da sessão', () => {
  it('lê custom-title, ai-title e summary com a origem de cada um', () => {
    const titles = lines(FIXTURE)
      .map(parseLine)
      .filter((e): e is Extract<TranscriptEvent, { kind: 'title' }> => e?.kind === 'title')
      .map((e) => [e.source, e.title])
    expect(titles).toEqual([
      ['ai', 'Cupom de desconto'],
      ['custom', 'Black Friday'],
      ['summary', 'Resumo antigo']
    ])
  })

  it('guarda o primeiro e o último pedido, sem avisos internos nem comandos', () => {
    const t = tracker(lines(FIXTURE))
    expect(t.firstPrompt).toBe('Adiciona cupom de desconto no carrinho')
    expect(t.lastPrompt).toBe('Agora escreve os testes')
    expect(t.startedAt).toBe(T0)
  })

  it('prefere o nome que a pessoa deu ao título gerado', () => {
    const t = tracker(lines(FIXTURE))
    expect(sessionName(t, null)).toBe('Black Friday')
    // Renomeada pelo registro (nameSource "user") e sem /rename no transcript.
    const semCustom = tracker(lines(FIXTURE).filter((l) => !l.includes('custom-title')))
    expect(sessionName(semCustom, { name: 'cupom-bf', nameSource: 'user' })).toBe('cupom-bf')
    expect(sessionName(semCustom, { name: 'loja-29', nameSource: 'derived' })).toBe('Cupom de desconto')
  })

  it('usa o primeiro pedido antes do nome derivado da pasta', () => {
    const t = tracker(lines(FIXTURE).filter((l) => !/"type": "(custom-title|ai-title|summary)"/.test(l)))
    expect(sessionName(t, { name: 'loja-29', nameSource: 'derived' })).toBe('Adiciona cupom de desconto no carrinho')
    expect(sessionName(new AgentTracker(), { name: 'loja-29', nameSource: 'derived' })).toBe('loja-29')
    expect(sessionName(new AgentTracker(), null)).toBeNull()
  })

  it('o estado da mesa traz nome, último pedido e início', () => {
    const store = new OfficeStore({ isAlive: () => false })
    store.ingestSession(SESSION, lines(FIXTURE))
    const [s] = store.snapshot(T0 + 10_000)
    expect(s).toMatchObject({ title: 'Black Friday', lastPrompt: 'Agora escreve os testes', startedAt: T0 })
  })
})
