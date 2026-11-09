// Mural de entregas do hall: junta os PRs, artefatos e commits de todas as sessões.
// Funções puras, testadas em tests/entregas.test.ts.

import type { Commit, PublishedLink, PullRequest, SessionState } from '@shared/types'
import { artifactCount, sessionTitle } from './describe'

export interface FromSession<T> {
  item: T
  sessionId: string
  from: string
}

export interface Board {
  prs: FromSession<PullRequest>[]
  links: FromSession<PublishedLink>[]
  commits: FromSession<Commit>[]
  /** Arquivos criados (os editados só aparecem no painel de cada mesa). */
  created: FromSession<{ path: string; cwd: string | null; at: number }>[]
  /** Totais para o quadro: artefatos = arquivos criados + publicados. */
  totals: { prs: number; commits: number; artifacts: number }
}

/** Tudo o que as sessões do escritório entregaram, do mais novo para o mais antigo. */
export function board(sessions: Iterable<SessionState>): Board {
  const out: Board = { prs: [], links: [], commits: [], created: [], totals: { prs: 0, commits: 0, artifacts: 0 } }
  const seenPr = new Set<string>()
  for (const s of sessions) {
    const d = s.deliverables
    const tag = <T>(item: T): FromSession<T> => ({ item, sessionId: s.id, from: sessionTitle(s) })
    for (const p of d.prs) {
      // Duas sessões podem ter mexido no mesmo PR: aparece uma vez só, com quem abriu primeiro.
      if (seenPr.has(p.url)) continue
      seenPr.add(p.url)
      out.prs.push(tag(p))
    }
    out.links.push(...d.links.map(tag))
    out.commits.push(...d.commits.map(tag))
    out.created.push(...d.files.filter((f) => f.created).map((f) => tag({ path: f.path, cwd: s.cwd, at: f.at })))
    out.totals.commits += d.commits.length
    out.totals.artifacts += artifactCount(d)
  }
  out.totals.prs = out.prs.length
  const newest = (a: FromSession<{ at: number }>, b: FromSession<{ at: number }>) => b.item.at - a.item.at
  out.prs.sort(newest)
  out.links.sort(newest)
  out.commits.sort(newest)
  out.created.sort(newest)
  return out
}

/** As linhas do quadro no hall. */
export function boardLines(b: Board): string[] {
  const { prs, artifacts, commits } = b.totals
  if (prs + artifacts + commits === 0) return ['Nada entregue ainda']
  const lines: string[] = []
  if (prs > 0) lines.push(`${prs} ${prs === 1 ? 'PR' : 'PRs'}`)
  if (artifacts > 0) lines.push(`${artifacts} ${artifacts === 1 ? 'artefato' : 'artefatos'}`)
  if (commits > 0) lines.push(`${commits} ${commits === 1 ? 'commit' : 'commits'}`)
  return lines
}
