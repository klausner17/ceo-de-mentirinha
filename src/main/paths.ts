// Classifica os caminhos que o watcher encontra em ~/.claude.

import { homedir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

export type ClaudeFile =
  /** projects/<pasta>/<sessão>.jsonl */
  | { kind: 'session'; sessionId: string }
  /** projects/<pasta>/<sessão>/subagents/agent-<id>.jsonl (versões recentes) */
  | { kind: 'subagent'; sessionId: string; agentId: string }
  /** projects/<pasta>/<sessão>/subagents/agent-<id>.meta.json */
  | { kind: 'subagent-meta'; sessionId: string; agentId: string }
  /** projects/<pasta>/agent-<id>.jsonl (versões antigas; o pai vem do sessionId das linhas) */
  | { kind: 'legacy-subagent'; agentId: string }
  /** sessions/<pid>.json: registro de processos em execução */
  | { kind: 'registry'; pid: number }
  | { kind: 'ignored' }

const AGENT_JSONL = /^agent-(.+)\.jsonl$/
const AGENT_META = /^agent-(.+)\.meta\.json$/

export function classify(path: string, root = claudeDir()): ClaudeFile {
  const parts = relative(root, path).split(sep)
  const name = basename(path)

  if (parts[0] === 'sessions' && parts.length === 2) {
    const m = /^(\d+)\.json$/.exec(name)
    return m ? { kind: 'registry', pid: Number(m[1]) } : { kind: 'ignored' }
  }

  if (parts[0] !== 'projects') return { kind: 'ignored' }

  // projects/<pasta>/<arquivo>
  if (parts.length === 3) {
    const legacy = AGENT_JSONL.exec(name)
    if (legacy) return { kind: 'legacy-subagent', agentId: legacy[1]! }
    if (name.endsWith('.jsonl')) return { kind: 'session', sessionId: name.slice(0, -'.jsonl'.length) }
    return { kind: 'ignored' }
  }

  // projects/<pasta>/<sessão>/subagents/<arquivo>
  if (parts.length === 5 && parts[3] === 'subagents') {
    const sessionId = parts[2]!
    const meta = AGENT_META.exec(name)
    if (meta) return { kind: 'subagent-meta', sessionId, agentId: meta[1]! }
    const agent = AGENT_JSONL.exec(name)
    if (agent) return { kind: 'subagent', sessionId, agentId: agent[1]! }
  }

  return { kind: 'ignored' }
}

/** Última parte de um caminho, para usar como nome curto do projeto. */
export function projectName(cwd: string | null): string {
  if (!cwd) return 'sem projeto'
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}
