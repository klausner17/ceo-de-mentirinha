import { describe, expect, it } from 'vitest'
import { classify, projectName } from '../src/main/paths'

const root = '/Users/ceo/.claude'

describe('classify', () => {
  it('reconhece cada tipo de arquivo', () => {
    expect(classify(`${root}/projects/-Users-ceo-loja/abc.jsonl`, root)).toEqual({ kind: 'session', sessionId: 'abc' })
    expect(classify(`${root}/projects/-Users-ceo-loja/abc/subagents/agent-x1.jsonl`, root)).toEqual({ kind: 'subagent', sessionId: 'abc', agentId: 'x1' })
    expect(classify(`${root}/projects/-Users-ceo-loja/abc/subagents/agent-x1.meta.json`, root)).toEqual({ kind: 'subagent-meta', sessionId: 'abc', agentId: 'x1' })
    expect(classify(`${root}/projects/-Users-ceo-loja/agent-x1.jsonl`, root)).toEqual({ kind: 'legacy-subagent', agentId: 'x1' })
    expect(classify(`${root}/sessions/88.json`, root)).toEqual({ kind: 'registry', pid: 88 })
  })

  it('ignora o resto', () => {
    expect(classify(`${root}/sessions/88.abc.key`, root).kind).toBe('ignored')
    expect(classify(`${root}/projects/-Users-ceo-loja/abc/ccr-tip.json`, root).kind).toBe('ignored')
    expect(classify(`${root}/settings.json`, root).kind).toBe('ignored')
  })
})

describe('projectName', () => {
  it('usa a última parte do cwd', () => {
    expect(projectName('/Users/ceo/code/loja/')).toBe('loja')
    expect(projectName(null)).toBe('sem projeto')
  })
})
