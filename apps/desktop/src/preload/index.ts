import { contextBridge, ipcRenderer } from 'electron'
import type { ShiftPaneApi } from './api.ts'

const platform: ShiftPaneApi['platform'] =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

const api: ShiftPaneApi = {
  platform,
  versions: {
    app: ipcRenderer.sendSync('app:version') as string,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
}

contextBridge.exposeInMainWorld('shiftpane', api)
