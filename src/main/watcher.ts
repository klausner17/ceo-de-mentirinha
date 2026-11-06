// Observa ~/.claude/projects e ~/.claude/sessions e alimenta o OfficeStore.

import { readFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { IncrementalReader } from './incremental-reader'
import type { OfficeStore } from './office-store'
import { classify, claudeDir } from './paths'

export interface WatcherOptions {
  root?: string
  /** Na abertura, só lê transcripts alterados neste intervalo. */
  recentMs?: number
}

export function watchClaude(store: OfficeStore, opts: WatcherOptions = {}): () => Promise<void> {
  const root = opts.root ?? claudeDir()
  const recentMs = opts.recentMs ?? Number(process.env.CEO_RECENT_HOURS ?? 6) * 3_600_000
  const reader = new IncrementalReader()
  let ready = false

  const relevant = (path: string, stats?: Stats): boolean => {
    if (!stats || stats.isDirectory()) return true
    return classify(path, root).kind !== 'ignored'
  }

  const handle = async (path: string, stats?: Stats): Promise<void> => {
    const file = classify(path, root)
    // Arquivos antigos são pulados na abertura; se mudarem depois, são lidos do zero.
    if (!ready && stats && Date.now() - stats.mtimeMs > recentMs && file.kind !== 'registry') return
    try {
      switch (file.kind) {
        case 'session':
          store.ingestSession(file.sessionId, await reader.readNewLines(path))
          break
        case 'subagent':
          store.ingestSubagent(file.sessionId, file.agentId, await reader.readNewLines(path))
          break
        case 'legacy-subagent':
          store.ingestSubagent(null, file.agentId, await reader.readNewLines(path))
          break
        case 'subagent-meta':
          store.setSubagentMeta(file.sessionId, file.agentId, await readFile(path, 'utf8'))
          break
        case 'registry':
          store.setRegistry(file.pid, await readFile(path, 'utf8'))
          break
        case 'ignored':
          return
      }
      if (ready) store.flush()
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        store.log('error', `Sem permissão para ler ${path}. No macOS, libere o acesso a pastas em Ajustes do Sistema > Privacidade e Segurança.`)
      } else if (e.code !== 'ENOENT') {
        store.log('warn', `Falha ao ler ${path}: ${e.message}`)
      }
    }
  }

  const removed = (path: string): void => {
    const file = classify(path, root)
    reader.forget(path)
    if (file.kind === 'registry') store.setRegistry(file.pid, null)
    store.flush()
  }

  const watcher: FSWatcher = chokidar.watch([join(root, 'projects'), join(root, 'sessions')], {
    ignored: (path, stats) => !relevant(path, stats),
    depth: 3,
    awaitWriteFinish: false
  })

  watcher
    .on('add', (p, s) => void handle(p, s))
    .on('change', (p, s) => void handle(p, s))
    .on('unlink', removed)
    .on('ready', () => {
      ready = true
      store.flush()
      store.log('info', `Observando ${root}`)
    })
    .on('error', (err) => store.log('error', `Watcher: ${(err as Error).message}`))

  // Ociosidade e saída não geram escrita em disco: recalcula de tempos em tempos.
  const timer = setInterval(() => store.flush(), 5_000)

  return async () => {
    clearInterval(timer)
    await watcher.close()
  }
}
