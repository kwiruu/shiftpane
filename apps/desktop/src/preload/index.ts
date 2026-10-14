import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { IpcChannel, type PairingState } from '../shared/pairing.ts'
import type { ShiftPaneApi } from './api.ts'

const platform: ShiftPaneApi['platform'] =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

const api: ShiftPaneApi = {
  platform,
  versions: {
    app: ipcRenderer.sendSync(IpcChannel.appVersion) as string,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
  pairing: {
    get: () => ipcRenderer.invoke(IpcChannel.pairingGet) as Promise<PairingState>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: PairingState) => listener(state)
      ipcRenderer.on(IpcChannel.pairingChanged, handler)
      return () => ipcRenderer.off(IpcChannel.pairingChanged, handler)
    },
    selectHost: (address) =>
      ipcRenderer.invoke(IpcChannel.pairingSelectHost, address) as Promise<void>,
    newCode: () => ipcRenderer.invoke(IpcChannel.pairingNewCode) as Promise<void>,
    disconnect: (phoneId) =>
      ipcRenderer.invoke(IpcChannel.phonesDisconnect, phoneId) as Promise<void>,
  },
}

contextBridge.exposeInMainWorld('shiftpane', api)
