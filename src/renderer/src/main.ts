import type { OfficeDelta, SessionState } from '@shared/types'
import type { Deliverables } from '@shared/types'
import { ago, cut, deskLine, deliverablesSummary, doing, newDeliveries, prLabel, roomKey, roomPeople, sessionDetails, sessionTitle, shortPath } from './describe'
import { board, boardLines } from './entregas'
import { emailKey, emailSubject, inbox, unreadCount } from './inbox'
import { Office3D, type Selection } from './world/office'

const logEl = document.getElementById('log')!
const detailsEl = document.getElementById('details')!

function log(level: 'info' | 'warn' | 'error', message: string, at = Date.now()): void {
  const line = document.createElement('div')
  line.className = level
  const time = document.createElement('time')
  time.textContent = new Date(at).toLocaleTimeString('pt-BR')
  line.append(time, message)
  logEl.append(line)
  while (logEl.childElementCount > 200) logEl.firstElementChild?.remove()
  logEl.scrollTop = logEl.scrollHeight
}

function describe(s: SessionState): string {
  return `${sessionTitle(s)} (${s.project}): ${doing(s, Date.now())}`
}

const scene = new Office3D(document.getElementById('game')!, document.getElementById('hint')!)
scene.start().catch((err: Error) => log('error', `Falha ao montar o escritório 3D: ${err.message}`))
log('info', 'Você é o CEO: ande com WASD ou as setas (Shift corre), chegue perto de uma mesa e aperte E. Arraste para girar a câmera.')

const known = new Map<string, SessionState>()

// Painel de detalhes: abre ao clicar numa mesa ou na placa de um cômodo.
let selected: Selection | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (cls) e.className = cls
  return e
}

// Caixa de entrada do CEO: chaves dos emails já lidos (só nesta janela; reabrir o app zera).
const read = new Set<string>()

/** Abrir a mesa de quem mandou o email conta como ler. */
function markRead(id: string): void {
  const a = known.get(id)?.awaiting
  if (a) read.add(emailKey(id, a))
}

/** Atualiza o contador no computador do CEO e o título da janela. */
function refreshInbox(): void {
  const emails = inbox(known.values(), read)
  const live = new Set(emails.map((e) => e.key))
  for (const k of read) if (!live.has(k)) read.delete(k)
  const unread = unreadCount(emails)
  scene.setInbox(unread, emails.length)
  document.title = unread > 0 ? `(${unread}) CEO de Mentirinha` : 'CEO de Mentirinha'
}

/** Atualiza o quadro de entregas do hall. */
function refreshBoard(): void {
  const b = board(known.values())
  const { prs, artifacts, commits } = b.totals
  scene.setBoard(boardLines(b), prs, prs + artifacts + commits === 0)
}

/** Link que abre no navegador (o processo principal manda para fora do app). */
function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', text)
  a.href = href
  a.target = '_blank'
  a.rel = 'noreferrer'
  return a
}

/** Um item de lista de entrega: texto (ou link) e uma linha pequena embaixo. */
function item(main: HTMLElement | string, small: string, cls?: string): HTMLLIElement {
  const li = el('li', undefined, cls)
  li.append(typeof main === 'string' ? el('span', main) : main, el('small', small))
  return li
}

const MAX_FILES_SHOWN = 8

/** A seção "Entregas" do painel de uma mesa: PRs, publicados, commits e arquivos. */
function deliverablesSection(d: Deliverables, cwd: string | null, now: number): HTMLElement[] {
  const summary = deliverablesSummary(d)
  if (!summary) return []
  const out: HTMLElement[] = [el('h3', 'Entregas'), el('p', summary, 'sub')]
  const list = (title: string, items: HTMLLIElement[]) => {
    if (items.length === 0) return
    const ul = el('ul', undefined, 'deliveries')
    ul.append(...items)
    out.push(el('h4', title), ul)
  }
  const newest = <T extends { at: number }>(xs: T[]) => [...xs].sort((a, b) => b.at - a.at)
  list('Pull requests', newest(d.prs).map((p) => item(link(p.url, prLabel(p)), `aberto ${ago(p.at, now)}`, 'pr')))
  list('Publicados', newest(d.links).map((l) => item(link(l.url, l.title ?? 'Artefato'), `publicado ${ago(l.at, now)}`, 'art')))
  list('Commits', newest(d.commits).slice(0, 6).map((c) => item(cut(c.message, 80), `${c.sha ?? 'commit'} · ${ago(c.at, now)}`, 'commit')))
  const files = newest(d.files)
  list(
    'Arquivos',
    files.slice(0, MAX_FILES_SHOWN).map((f) => item(shortPath(f.path, cwd), `${f.created ? 'criado' : 'editado'} ${ago(f.at, now)}`, f.created ? 'art' : 'file'))
  )
  const hidden = d.filesTotal - Math.min(files.length, MAX_FILES_SHOWN)
  if (hidden > 0) out.push(el('p', `e mais ${hidden} ${hidden === 1 ? 'arquivo' : 'arquivos'}`, 'sub'))
  return out
}

/** O painel do quadro de entregas: o que a casa inteira entregou, com links. */
function renderBoard(close: HTMLElement, now: number): void {
  const b = board(known.values())
  const body: HTMLElement[] = [close, el('h2', 'Quadro de entregas')]
  const { prs, artifacts, commits } = b.totals
  if (prs + artifacts + commits === 0) {
    body.push(el('p', 'Ninguém entregou nada ainda. PRs, commits e artefatos aparecem aqui.', 'sub'))
  } else {
    body.push(el('p', boardLines(b).join(' · '), 'sub'))
    const list = (title: string, items: HTMLLIElement[]) => {
      if (items.length === 0) return
      const ul = el('ul', undefined, 'deliveries')
      ul.append(...items)
      body.push(el('h4', title), ul)
    }
    const who = (from: string, at: number, verb: string) => `${from} · ${verb} ${ago(at, now)}`
    list('Pull requests', b.prs.map(({ item: p, from }) => item(link(p.url, prLabel(p)), who(from, p.at, 'aberto'), 'pr')))
    list('Publicados', b.links.map(({ item: l, from }) => item(link(l.url, l.title ?? 'Artefato'), who(from, l.at, 'publicado'), 'art')))
    list('Arquivos criados', b.created.slice(0, 12).map(({ item: f, from }) => item(shortPath(f.path, f.cwd), who(from, f.at, 'criado'), 'art')))
    list('Commits', b.commits.slice(0, 10).map(({ item: c, from }) => item(cut(c.message, 80), `${from} · ${c.sha ? `${c.sha} · ` : ''}${ago(c.at, now)}`, 'commit')))
  }
  detailsEl.replaceChildren(...body)
  detailsEl.hidden = false
}

function select(sel: Selection | null): void {
  selected = sel
  if (sel?.kind === 'session') markRead(sel.id)
  scene.select(sel)
  renderDetails()
  refreshInbox()
}

function renderDetails(): void {
  const now = Date.now()
  const close = el('button', '×', 'close')
  close.title = 'Fechar (Esc)'
  close.onclick = () => select(null)

  if (selected?.kind === 'session') {
    const s = known.get(selected.id)
    if (!s) {
      // A sessão foi embora: fecha o painel.
      selected = null
      scene.select(null)
    } else {
      const dl = el('dl')
      for (const row of sessionDetails(s, now)) {
        const mono = row.label === 'Sessão' || row.label === 'Pasta'
        dl.append(el('dt', row.label), el('dd', row.value, mono ? 'mono' : undefined))
      }
      detailsEl.replaceChildren(close, el('h2', sessionTitle(s)), el('p', `Ala ${s.project}`, 'sub'), dl, ...deliverablesSection(s.deliverables, s.cwd, now))
      detailsEl.hidden = false
      return
    }
  }

  if (selected?.kind === 'inbox') {
    const emails = inbox(known.values(), read)
    const unread = unreadCount(emails)
    const body: HTMLElement[] = [close, el('h2', 'Caixa de entrada')]
    body.push(el('p', emails.length === 0 ? 'Ninguém precisa de você agora.' : `${unread} não lido(s) de ${emails.length}`, 'sub'))
    if (emails.length > 0) {
      const ul = el('ul')
      for (const e of emails) {
        const btn = el('button', `${e.unread ? '● ' : ''}${e.subject}`, e.unread ? 'unread' : undefined)
        btn.append(el('small', `${e.from} · Ala ${e.project} · ${ago(e.since, now)}`))
        btn.onclick = () => select({ kind: 'session', id: e.sessionId })
        const li = el('li')
        li.append(btn)
        ul.append(li)
      }
      body.push(ul)
      if (unread > 0) {
        const all = el('button', 'Marcar todos como lidos', 'link')
        all.onclick = () => {
          for (const e of emails) read.add(e.key)
          renderDetails()
          refreshInbox()
        }
        body.push(all)
      }
    }
    detailsEl.replaceChildren(...body)
    detailsEl.hidden = false
    return
  }

  if (selected?.kind === 'entregas') {
    renderBoard(close, now)
    return
  }

  if (selected?.kind === 'room') {
    const key = selected.key
    const list = [...known.values()].filter((s) => roomKey(s) === key)
    if (list.length > 0) {
      const ul = el('ul')
      for (const s of list.sort((a, b) => b.lastActivity - a.lastActivity)) {
        const btn = el('button', sessionTitle(s))
        btn.append(el('small', deskLine(s, now)))
        btn.onclick = () => select({ kind: 'session', id: s.id })
        const li = el('li')
        li.append(btn)
        ul.append(li)
      }
      detailsEl.replaceChildren(close, el('h2', `Ala ${list[0]!.project}`), el('p', `${roomPeople(list)} · ${key}`, 'sub'), ul)
      detailsEl.hidden = false
      return
    }
    selected = null
  }

  detailsEl.hidden = true
  detailsEl.replaceChildren()
}

scene.onSelect = (sel) => select(sel)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') select(null)
})
// "há 3 min" envelhece sozinho.
setInterval(() => {
  if (selected) renderDetails()
}, 15_000)

function apply(delta: OfficeDelta): void {
  switch (delta.kind) {
    case 'snapshot':
      known.clear()
      for (const s of delta.sessions) known.set(s.id, s)
      scene.setSessions(delta.sessions)
      refreshInbox()
      refreshBoard()
      renderDetails()
      log('info', `${delta.sessions.length} sessão(ões) no escritório`)
      break
    case 'upsert': {
      const s = delta.session
      const before = known.get(s.id)
      known.set(s.id, s)
      scene.upsert(s)
      // Email novo: alguém passou a esperar o CEO (ou por outro motivo).
      const a = s.awaiting
      if (a && (!before?.awaiting || emailKey(s.id, before.awaiting) !== emailKey(s.id, a))) {
        // Quem está com a mesa aberta no painel já está lendo.
        if (selected?.kind === 'session' && selected.id === s.id) read.add(emailKey(s.id, a))
        else log(a.reason === 'relatorio' ? 'info' : 'warn', `Email de ${sessionTitle(s)}: ${emailSubject(s, a)}`)
      }
      // Entregas novas viram linha no log (a mesa comemora sozinha).
      const fresh = newDeliveries(before?.deliverables ?? null, s.deliverables)
      for (const p of fresh.prs) log('info', `${sessionTitle(s)} abriu ${prLabel(p)}`)
      if (fresh.artifacts > 0) log('info', `${sessionTitle(s)} entregou ${fresh.artifacts === 1 ? 'um artefato novo' : `${fresh.artifacts} artefatos novos`}`)
      refreshInbox()
      refreshBoard()
      if (selected) renderDetails()
      if (!before) log('info', `Chegou: ${describe(delta.session)}`)
      else if (before.currentTool?.id !== delta.session.currentTool?.id || before.status !== delta.session.status)
        log('info', describe(delta.session))
      break
    }
    case 'remove': {
      const gone = known.get(delta.id)
      known.delete(delta.id)
      scene.remove(delta.id)
      refreshInbox()
      refreshBoard()
      renderDetails()
      log('info', `Foi embora: ${gone ? sessionTitle(gone) : delta.id.slice(0, 8)}`)
      break
    }
    case 'log':
      log(delta.level, delta.message, delta.at)
      break
  }
}

if (!window.office) {
  log('error', 'API do escritório indisponível (preload não carregou).')
} else {
  window.office.onDelta(apply)
  window.office
    .getSnapshot()
    .then((sessions) => apply({ kind: 'snapshot', sessions }))
    .catch((err: Error) => log('error', `Falha ao carregar sessões: ${err.message}`))
}
