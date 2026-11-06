// Ponte segura: o renderer só enxerga esta API, nunca o sistema de arquivos.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type OfficeApi, type OfficeDelta } from '@shared/types'

const api: OfficeApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  onDelta(listener) {
    const wrapped = (_e: IpcRendererEvent, d: OfficeDelta) => listener(d)
    ipcRenderer.on(IPC.delta, wrapped)
    return () => ipcRenderer.removeListener(IPC.delta, wrapped)
  }
}

contextBridge.exposeInMainWorld('office', api)
