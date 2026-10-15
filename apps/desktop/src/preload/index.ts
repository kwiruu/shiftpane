import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { CaptureEvent } from '../shared/capture.ts'
import type { DisplayState } from '../shared/display.ts'
import type { FirewallAllowResult, FirewallState } from '../shared/firewall.ts'
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
  firewall: {
    get: () => ipcRenderer.invoke(IpcChannel.firewallGet) as Promise<FirewallState>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: FirewallState) => listener(state)
      ipcRenderer.on(IpcChannel.firewallChanged, handler)
      return () => ipcRenderer.off(IpcChannel.firewallChanged, handler)
    },
    check: () => ipcRenderer.invoke(IpcChannel.firewallCheck) as Promise<void>,
    allow: () => ipcRenderer.invoke(IpcChannel.firewallAllow) as Promise<FirewallAllowResult>,
    openSettings: (page) =>
      ipcRenderer.invoke(IpcChannel.firewallOpenSettings, page) as Promise<void>,
  },
  display: {
    get: () => ipcRenderer.invoke(IpcChannel.displayGet) as Promise<DisplayState>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: DisplayState) => listener(state)
      ipcRenderer.on(IpcChannel.displayChanged, handler)
      return () => ipcRenderer.off(IpcChannel.displayChanged, handler)
    },
    retry: () => ipcRenderer.invoke(IpcChannel.displayRetry) as Promise<void>,
  },
  capture: {
    onCommand: (listener) => {
      const handler = (_event: IpcRendererEvent, command: unknown) => listener(command)
      ipcRenderer.on(IpcChannel.captureCommand, handler)
      return () => ipcRenderer.off(IpcChannel.captureCommand, handler)
    },
    send: (event: CaptureEvent) => ipcRenderer.send(IpcChannel.captureEvent, event),
  },
}

contextBridge.exposeInMainWorld('shiftpane', api)
