import Phaser from 'phaser'
import type { OfficeDelta, SessionState } from '@shared/types'
import { OfficeScene } from './scenes/OfficeScene'

const logEl = document.getElementById('log')!

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
  const tool = s.currentTool ? ` · ${s.currentTool.name}` : ''
  return `${s.project} @ ${s.branch ?? '?'} · ${s.model ?? 'modelo ?'} · ${s.status}${tool}`
}

const scene = new OfficeScene()

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1f27',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene
})

const known = new Map<string, SessionState>()

function apply(delta: OfficeDelta): void {
  switch (delta.kind) {
    case 'snapshot':
      known.clear()
      for (const s of delta.sessions) known.set(s.id, s)
      scene.setSessions(delta.sessions)
      log('info', `${delta.sessions.length} sessão(ões) no escritório`)
      break
    case 'upsert': {
      const before = known.get(delta.session.id)
      known.set(delta.session.id, delta.session)
      scene.upsert(delta.session)
      if (!before) log('info', `Chegou: ${describe(delta.session)}`)
      else if (before.currentTool?.id !== delta.session.currentTool?.id || before.status !== delta.session.status)
        log('info', describe(delta.session))
      break
    }
    case 'remove':
      known.delete(delta.id)
      scene.remove(delta.id)
      log('info', `Foi embora: ${delta.id.slice(0, 8)}`)
      break
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
