// O que uma sessão entregou: PRs, commits, arquivos e artefatos publicados.
// Recebe as ferramentas que terminaram (com o input e o começo do resultado) e as linhas
// `pr-link`. Não conhece arquivos nem nomes de campos do transcript: isso é do parser.

import type { Commit, Deliverables, FileChange, PublishedLink, PullRequest } from '@shared/types'
import type { ToolInput } from './parser'

/** Quantos arquivos mexidos guardar na lista (o total continua contando). */
const MAX_FILES = 30
const MAX_COMMITS = 30
const MAX_LINKS = 30

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/
const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/
/** `[main 1a2b3c4] Mensagem`, `[feat/x (root-commit) 1a2b3c4] Mensagem`. */
const GIT_COMMIT_LINE = /^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/m

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
/** Ferramentas (MCP) que abrem PR: `create_pull_request`, `createPullRequest`, `create_pr`. */
const PR_TOOL = /create_?pull_?request|create_pr$/i
/** Ferramentas (MCP) que fazem commit direto no repositório. */
const COMMIT_TOOL = /push_files|create_or_update_file/i
/** Ferramentas que publicam artefatos ou documentos com link do claude.ai. */
const ARTIFACT_TOOL = /^Artifact$|Claude_Docs__(?:create|batch)$/
/** Ações da ferramenta de artefatos que não publicam nada. */
const READ_ACTIONS = new Set(['read', 'list', 'open', 'pin', 'unpin', 'quickstart', 'delete'])

/** "gh pr create --title 'Cupom' ..." → "Cupom". */
function titleFromCommand(command: string): string | null {
  const m = /--title[ =](?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

/** `git commit -m "Mensagem"` → "Mensagem" (só a primeira linha). */
function messageFromCommand(command: string): string | null {
  const m = /-m\s+(?:"([^"]+)"|'([^']+)')/.exec(command)
  const msg = m ? (m[1] ?? m[2]) : null
  return msg ? msg.split('\n')[0]!.trim() || null : null
}

export class DeliverablesTracker {
  private readonly prs = new Map<string, PullRequest>()
  private readonly commits: Commit[] = []
  private readonly files = new Map<string, FileChange>()
  private created = 0
  private readonly links = new Map<string, PublishedLink>()

  /** Linha `pr-link` do transcript. Retorna true se é um PR novo. */
  linkPr(pr: { number: number; url: string; repository: string | null }, at: number): boolean {
    const old = this.prs.get(pr.url)
    if (old) {
      if (!old.repository && pr.repository) old.repository = pr.repository
      return false
    }
    this.prs.set(pr.url, { number: pr.number, url: pr.url, repository: pr.repository, title: null, at })
    return true
  }

  /** Uma ferramenta terminou. Retorna true se apareceu alguma entrega nova. */
  toolDone(
    tool: { name: string; input: ToolInput },
    result: { isError: boolean; text: string | null; fileOp: 'create' | 'update' | null },
    at: number
  ): boolean {
    if (result.isError) return false
    const { name, input } = tool
    const text = result.text ?? ''

    if (FILE_TOOLS.has(name) && input.filePath) {
      const old = this.files.get(input.filePath)
      // Write sem `toolUseResult` (versões antigas): não dá para saber se criou.
      const created = (old?.created ?? false) || (name === 'Write' && result.fileOp === 'create')
      if (created && !old?.created) this.created++
      this.files.delete(input.filePath)
      this.files.set(input.filePath, { path: input.filePath, created, at })
      return true
    }

    if (name === 'Bash' && input.command) {
      let changed = false
      if (/\bgh\s+pr\s+create\b/.test(input.command)) changed = this.addPr(text, titleFromCommand(input.command), at) || changed
      if (/\bgit\s+commit\b/.test(input.command)) {
        const m = GIT_COMMIT_LINE.exec(text)
        if (m) changed = this.addCommit({ sha: m[1]!.slice(0, 7), message: m[2]!.trim(), at }) || changed
      }
      return changed
    }

    if (PR_TOOL.test(name)) return this.addPr(text, input.title, at)
    if (COMMIT_TOOL.test(name)) return this.addCommit({ sha: null, message: input.message ?? 'Commit pelo GitHub', at })

    if (ARTIFACT_TOOL.test(name) && !(input.action && READ_ACTIONS.has(input.action))) {
      const url = ARTIFACT_URL.exec(text)?.[0]
      if (!url) return false
      const old = this.links.get(url)
      if (old) {
        // Republicar o mesmo artefato: vai para o fim da lista.
        this.links.delete(url)
        this.links.set(url, { ...old, title: input.title ?? old.title, at })
        return true
      }
      this.links.set(url, { url, title: input.title, at })
      while (this.links.size > MAX_LINKS) this.links.delete(this.links.keys().next().value!)
      return true
    }
    return false
  }

  private addPr(text: string, title: string | null, at: number): boolean {
    const m = PR_URL.exec(text)
    if (!m) return false
    const url = m[0]
    const old = this.prs.get(url)
    if (old) {
      if (old.title || !title) return false
      old.title = title
      return true
    }
    this.prs.set(url, { number: Number(m[2]), url, repository: m[1]!, title, at })
    return true
  }

  private addCommit(c: Commit): boolean {
    if (c.sha && this.commits.some((x) => x.sha === c.sha)) return false
    this.commits.push(c)
    if (this.commits.length > MAX_COMMITS) this.commits.shift()
    return true
  }

  /** Copia as entregas de outros rastreadores, na ordem em que aconteceram. */
  absorb(others: DeliverablesTracker[]): void {
    const byAt = <T extends { at: number }>(a: T, b: T) => a.at - b.at
    for (const p of others.flatMap((o) => [...o.prs.values()]).sort(byAt)) if (!this.prs.has(p.url)) this.prs.set(p.url, { ...p })
    for (const c of others.flatMap((o) => o.commits).sort(byAt)) this.addCommit(c)
    for (const f of others.flatMap((o) => [...o.files.values()]).sort(byAt)) {
      const old = this.files.get(f.path)
      const created = f.created || (old?.created ?? false)
      if (created && !old?.created) this.created++
      this.files.delete(f.path)
      this.files.set(f.path, { ...f, created })
    }
    for (const l of others.flatMap((o) => [...o.links.values()]).sort(byAt)) {
      this.links.delete(l.url)
      this.links.set(l.url, l)
    }
  }

  /** Estado para o renderer: listas da mais antiga para a mais nova. */
  snapshot(): Deliverables {
    const files = [...this.files.values()]
    return {
      prs: [...this.prs.values()].map((p) => ({ ...p })),
      commits: [...this.commits],
      files: files.slice(-MAX_FILES),
      filesTotal: files.length,
      filesCreated: this.created,
      links: [...this.links.values()]
    }
  }
}

/** Junta as entregas da sessão com as dos ajudantes (subagentes). */
export function mergeDeliverables(trackers: DeliverablesTracker[]): Deliverables {
  if (trackers.length === 1) return trackers[0]!.snapshot()
  const merged = new DeliverablesTracker()
  merged.absorb(trackers)
  return merged.snapshot()
}

export const emptyDeliverables = (): Deliverables => ({ prs: [], commits: [], files: [], filesTotal: 0, filesCreated: 0, links: [] })
