// Processo principal do Electron: lê os arquivos e conversa com o renderer por IPC.

import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, type OfficeDelta } from '@shared/types'
import { demoSessions } from './demo'
import { OfficeStore } from './office-store'
import { watchClaude } from './watcher'

// CEO_DEMO=1 mostra sessões falsas, para testar o jogo sem Claude Code rodando.
const demo = process.env.CEO_DEMO === '1' || process.argv.includes('--demo')

let window: BrowserWindow | null = null
const store = new OfficeStore()

function send(delta: OfficeDelta): void {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.delta, delta)
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'CEO de Mentirinha',
    backgroundColor: '#1d1f27',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  // Links de PR e de artefato abrem no navegador, nunca dentro do app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (e, url) => {
    if (url !== window?.webContents.getURL()) e.preventDefault()
  })
  window.on('closed', () => (window = null))
}

app.whenReady().then(() => {
  ipcMain.handle(IPC.snapshot, () => (demo ? demoSessions(Date.now()) : store.snapshot()))
  store.onDelta(send)

  const stop = demo ? startDemo() : watchClaude(store)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('will-quit', () => void stop?.())
})

/** Modo demo: as sessões falsas mudam a cada 3 segundos. */
function startDemo(): () => Promise<void> {
  const started = Date.now()
  let step = 0
  const timer = setInterval(() => {
    step++
    for (const session of demoSessions(Date.now(), step, started)) send({ kind: 'upsert', session })
  }, 3000)
  return async () => clearInterval(timer)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
