import { describe, expect, it } from 'vitest'
import type { OfficeDelta } from '../src/shared/types'
import { OfficeStore } from '../src/main/office-store'
import { fixture, lines, SESSION, T0 } from './helpers'

const opts = { idleMs: 5 * 60_000, goneMs: 30 * 60_000, goneWithRegistryMs: 2 * 60_000, subagentGoneMs: 10 * 60_000 }
const newStore = (alive: number[] = []) => new OfficeStore({ ...opts, isAlive: (pid) => alive.includes(pid) })

describe('OfficeStore', () => {
  it('monta a mesa com projeto, branch, modelo, título e ferramenta em uso', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    const [s] = store.snapshot(T0 + 10_000)
    expect(s).toMatchObject({
      project: 'loja',
      branch: 'feat/cupom',
      model: 'claude-sonnet-5-5',
      seniority: 'pleno',
      title: 'Cupom de desconto',
      currentTool: { id: 'toolu_2', name: 'Edit' },
      status: 'trabalhando'
    })
  })

  it('deduplica usage por message.id e usa o último turno como contexto', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    const [s] = store.snapshot(T0 + 10_000)
    // msg_A aparece em duas linhas: 120 conta uma vez só. msg_B: 300.
    expect(s!.outputTokens).toBe(420)
    expect(s!.contextTokens).toBe(2 + 35000 + 1000)
  })

  it('ignora linhas de sidechain no arquivo do pai', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    // A linha de sidechain tem timestamp :09; a última linha principal é :04.
    expect(store.snapshot(T0 + 10_000)[0]!.lastActivity).toBe(T0 + 4_000)
  })

  it('libera a ferramenta quando chega o tool_result e fica ociosa depois de N minutos', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    store.ingestSession(SESSION, lines('session-2.1.318-turn-end.jsonl'))
    expect(store.snapshot(T0 + 10_000)[0]).toMatchObject({ currentTool: null, status: 'trabalhando' })
    expect(store.snapshot(T0 + 6 * 60_000)[0]).toMatchObject({ status: 'ocioso' })
  })

  it('sem registro de processos, a sessão some depois de 30 minutos parada', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    expect(store.snapshot(T0 + 29 * 60_000)).toHaveLength(1)
    expect(store.snapshot(T0 + 31 * 60_000)).toHaveLength(0)
  })

  it('com registro de processo vivo, a sessão fica; sem processo, vai embora', () => {
    const store = newStore([4242])
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    store.ingestSession(SESSION, lines('session-2.1.318-turn-end.jsonl'))
    store.setRegistry(4242, fixture('registry-4242.json'))
    expect(store.snapshot(T0 + 60 * 60_000)[0]).toMatchObject({ running: true, status: 'ocioso' })
    store.setRegistry(4242, null)
    expect(store.snapshot(T0 + 60 * 60_000)).toHaveLength(0)
  })

  it('mostra subagentes como liderados e tira quando terminam', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    store.ingestSubagent(SESSION, 'abc123', lines('subagent-2.1.318-working.jsonl'))
    store.setSubagentMeta(SESSION, 'abc123', fixture('subagent.meta.json'))
    expect(store.snapshot(T0 + 12_000)[0]!.subagents).toMatchObject([
      { id: 'abc123', agentType: 'Explore', model: 'claude-haiku-5-5', currentTool: { name: 'Grep' } }
    ])
    store.ingestSubagent(SESSION, 'abc123', lines('subagent-2.1.318-done.jsonl'))
    expect(store.snapshot(T0 + 14_000)[0]!.subagents).toEqual([])
  })

  it('subagente no formato antigo encontra o pai pelo sessionId das linhas', () => {
    const store = newStore()
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    store.ingestSubagent(null, 'abc123', lines('subagent-2.1.318-working.jsonl'))
    expect(store.snapshot(T0 + 12_000)[0]!.subagents).toHaveLength(1)
  })

  it('flush emite só o que mudou, e remove quem saiu', () => {
    const store = newStore()
    const deltas: OfficeDelta[] = []
    store.onDelta((d) => deltas.push(d))
    store.ingestSession(SESSION, lines('session-2.1.318-tool-pending.jsonl'))
    store.flush(T0 + 10_000)
    store.flush(T0 + 11_000)
    expect(deltas.map((d) => d.kind)).toEqual(['upsert'])
    store.flush(T0 + 31 * 60_000)
    expect(deltas.map((d) => d.kind)).toEqual(['upsert', 'remove'])
  })
})
