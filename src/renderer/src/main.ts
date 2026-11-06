import Phaser from 'phaser'
import type { OfficeDelta, SessionState } from '@shared/types'
import { ago, deskLine, doing, roomKey, roomPeople, sessionDetails, sessionTitle } from './describe'
import { emailKey, emailSubject, inbox, unreadCount } from './inbox'
import { OfficeScene, type Selection } from './scenes/OfficeScene'

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

const scene = new OfficeScene()

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1f27',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene
})

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
      detailsEl.replaceChildren(close, el('h2', sessionTitle(s)), el('p', `Ala ${s.project}`, 'sub'), dl)
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
      refreshInbox()
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
