import { describe, expect, it } from 'vitest'
import type { Deliverables, SessionState } from '../src/shared/types'
import { parseLine } from '../src/main/parser'
import { DeliverablesTracker } from '../src/main/deliverables'
import { OfficeStore } from '../src/main/office-store'
import { deliverableChips, deliverablesSummary, newDeliveries, prLabel, shortPath } from '../src/renderer/src/describe'
import { board, boardLines } from '../src/renderer/src/entregas'
import { lines, SESSION, T0 } from './helpers'

const FIXTURE = 'session-2.1.321-entregas.jsonl'
const opts = { idleMs: 5 * 60_000, goneMs: 30 * 60_000, goneWithRegistryMs: 2 * 60_000, subagentGoneMs: 10 * 60_000, mcpResultMs: 30_000, isAlive: () => false }
const empty = (): Deliverables => ({ prs: [], commits: [], files: [], filesTotal: 0, filesCreated: 0, links: [] })

describe('parser: campos usados para as entregas', () => {
  const evs = lines(FIXTURE).map(parseLine)

  it('lê o input das ferramentas (comando, arquivo, título, ação)', () => {
    const uses = evs.flatMap((e) => (e?.kind === 'assistant' ? e.toolUses : []))
    expect(uses.find((t) => t.id === 'toolu_w1')?.input.filePath).toBe('/Users/ceo/code/loja/src/cupom.ts')
    expect(uses.find((t) => t.id === 'toolu_b2')?.input.command).toContain('gh pr create')
    expect(uses.find((t) => t.id === 'toolu_m1')?.input.title).toBe('Cupom na API')
    expect(uses.find((t) => t.id === 'toolu_a2')?.input.action).toBe('read')
  })

  it('lê o texto do resultado e se o Write criou o arquivo', () => {
    const results = evs.flatMap((e) => (e?.kind === 'user' ? e.toolResults : []))
    expect(results.find((r) => r.toolUseId === 'toolu_w1')).toMatchObject({ fileOp: 'create', isError: false })
    expect(results.find((r) => r.toolUseId === 'toolu_b2')?.text).toBe('https://github.com/ceo/loja/pull/7')
    // Conteúdo em blocos `text` (MCP).
    expect(results.find((r) => r.toolUseId === 'toolu_m1')?.text).toContain('/pull/8')
  })

  it('lê a linha pr-link', () => {
    expect(evs.find((e) => e?.kind === 'pr-link')).toMatchObject({ number: 7, url: 'https://github.com/ceo/loja/pull/7', repository: 'ceo/loja' })
  })

  it('pr-link sem número ou url vira `other`, sem erro', () => {
    expect(parseLine('{"type":"pr-link","prNumber":"x"}')).toMatchObject({ kind: 'other', type: 'pr-link' })
  })
})

describe('entregas de uma sessão', () => {
  const store = new OfficeStore(opts)
  store.ingestSession(SESSION, lines(FIXTURE))
  const d = store.snapshot(T0 + 130_000)[0]!.deliverables

  it('acha os PRs do gh pr create (com título) e do MCP, sem repetir o do pr-link', () => {
    expect(d.prs).toMatchObject([
      { number: 7, repository: 'ceo/loja', title: 'Cupom de desconto' },
      { number: 8, repository: 'ceo/loja', title: 'Cupom na API' }
    ])
  })

  it('conta o commit com hash e ignora "nothing to commit"', () => {
    expect(d.commits).toMatchObject([{ sha: '1a2b3c4', message: 'Adiciona cupom de desconto' }])
  })

  it('separa arquivo criado de editado e ignora o Write com erro', () => {
    expect(d.files.map((f) => [f.path.split('/').pop(), f.created])).toEqual([
      ['cupom.ts', true],
      ['carrinho.ts', false]
    ])
    expect(d).toMatchObject({ filesTotal: 2, filesCreated: 1 })
  })

  it('guarda o artefato publicado e ignora o que só foi lido', () => {
    expect(d.links).toMatchObject([{ url: 'https://claude.ai/artifact/abc123', title: 'Regras do cupom' }])
  })

  it('junta as entregas dos ajudantes, mesmo depois que eles terminam', () => {
    const s = new OfficeStore(opts)
    s.ingestSession(SESSION, lines('session-2.1.318-turn-end.jsonl'))
    s.ingestSubagent(SESSION, 'agente-1', lines(FIXTURE))
    const merged = s.snapshot(T0 + 130_000)[0]!.deliverables
    expect(merged.prs).toHaveLength(2)
    expect(merged.filesTotal).toBe(2)
  })
})

describe('DeliverablesTracker', () => {
  const ok = { isError: false, text: null, fileOp: null } as const
  const input = { command: null, filePath: null, title: null, message: null, action: null }

  it('arquivo editado e depois reescrito continua contando uma vez', () => {
    const t = new DeliverablesTracker()
    t.toolDone({ name: 'Write', input: { ...input, filePath: '/a.ts' } }, { ...ok, fileOp: 'create' }, 1)
    t.toolDone({ name: 'Edit', input: { ...input, filePath: '/a.ts' } }, ok, 2)
    expect(t.snapshot()).toMatchObject({ filesTotal: 1, filesCreated: 1, files: [{ path: '/a.ts', created: true, at: 2 }] })
  })

  it('commit por MCP usa a mensagem do input', () => {
    const t = new DeliverablesTracker()
    t.toolDone({ name: 'mcp__github__push_files', input: { ...input, message: 'Sobe tudo' } }, ok, 1)
    expect(t.snapshot().commits).toMatchObject([{ sha: null, message: 'Sobe tudo' }])
  })
})

describe('textos das entregas', () => {
  const d: Deliverables = {
    prs: [
      { number: 7, url: 'https://github.com/ceo/loja/pull/7', repository: 'ceo/loja', title: 'Cupom', at: 1 },
      { number: 8, url: 'https://github.com/ceo/loja/pull/8', repository: 'ceo/loja', title: null, at: 2 }
    ],
    commits: [{ sha: 'abc1234', message: 'x', at: 1 }],
    files: [{ path: '/Users/ceo/code/loja/src/a.ts', created: true, at: 1 }],
    filesTotal: 3,
    filesCreated: 1,
    links: [{ url: 'https://claude.ai/artifact/a', title: null, at: 1 }]
  }

  it('plaquinhas da mesa só com o que existe', () => {
    expect(deliverableChips(d).map((c) => c.text)).toEqual(['2 PRs', '1 commit', '2 artefatos'])
    expect(deliverableChips({ ...empty(), prs: [d.prs[0]!] }).map((c) => c.text)).toEqual(['PR #7'])
    expect(deliverableChips(empty())).toEqual([])
  })

  it('resumo, rótulo do PR e caminho curto', () => {
    expect(deliverablesSummary(d)).toBe('2 PRs · 1 commit · 3 arquivos (1 novo) · 1 publicado')
    expect(deliverablesSummary(empty())).toBeNull()
    expect(prLabel(d.prs[0]!)).toBe('loja#7 · Cupom')
    expect(prLabel({ ...d.prs[1]!, repository: null })).toBe('PR #8')
    expect(shortPath('/Users/ceo/code/loja/src/a.ts', '/Users/ceo/code/loja')).toBe('src/a.ts')
    expect(shortPath('/tmp/x/y/z.html', '/Users/ceo')).toBe('…/y/z.html')
  })

  it('só comemora o que é novo, e nada ao abrir o app', () => {
    expect(newDeliveries(null, d)).toEqual({ prs: [], commits: 0, artifacts: 0 })
    const before = { ...d, prs: [d.prs[0]!], links: [] }
    expect(newDeliveries(before, d)).toMatchObject({ prs: [{ number: 8 }], commits: 0, artifacts: 1 })
  })

  it('quadro do hall junta as sessões e não repete PR', () => {
    const s = (id: string, title: string, deliverables: Deliverables) => ({ id, title, cwd: '/Users/ceo/code/loja', deliverables }) as SessionState
    const b = board([s('a', 'Cupom', d), s('b', 'Revisão', { ...empty(), prs: [d.prs[0]!] })])
    expect(b.totals).toEqual({ prs: 2, commits: 1, artifacts: 2 })
    expect(b.prs.map((p) => [p.item.number, p.from])).toEqual([
      [8, 'Cupom'],
      [7, 'Cupom']
    ])
    expect(boardLines(b)).toEqual(['2 PRs', '2 artefatos', '1 commit'])
    expect(boardLines(board([]))).toEqual(['Nada entregue ainda'])
  })
})
