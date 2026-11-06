import { describe, expect, it } from 'vitest'
import { demoSessions } from '../src/main/demo'

describe('demoSessions', () => {
  it('liderados chegam no passo 2 e saem no passo 7', () => {
    const team = (step: number) => demoSessions(0, step)[0]!.subagents.length
    expect([1, 2, 6, 7].map(team)).toEqual([0, 2, 2, 0])
  })

  it('o erro do demo mantém o mesmo horário dentro do ciclo, para disparar uma vez só', () => {
    const errorAt = (step: number) => demoSessions(step * 3000, step, 0)[1]!.lastErrorAt
    expect(errorAt(3)).toBeNull()
    expect(errorAt(4)).toBe(errorAt(9))
    expect(errorAt(14)).not.toBe(errorAt(4))
  })
})

describe('office boys do demo', () => {
  it('forma fila no Jira e o Drive falha', () => {
    const at = (step: number) => demoSessions(0, step, 0)
    expect(at(3)[0]!.mcpCalls.map((c) => c.server)).toEqual(['jira', 'jira'])
    expect(at(4)[0]!.mcpResults).toMatchObject([{ server: 'jira', ok: true }])
    expect(at(6)[1]!.mcpResults).toMatchObject([{ server: 'claude_ai_Google_Drive', ok: false }])
  })
})
