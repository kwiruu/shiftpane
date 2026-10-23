import type { Board, MonitorInfo } from '@shiftpane/protocol'
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { CaptureEvent } from '../shared/capture.ts'
import type { DisplayState } from '../shared/display.ts'
import type { FirewallAllowResult, FirewallState } from '../shared/firewall.ts'
import { IpcChannel, type PairingState } from '../shared/pairing.ts'
import type { Recipe } from '../shared/studio.ts'
import type {
  AccountState,
  AppSettings,
  FolderCheck,
  GeneratorModels,
  GeneratorResult,
  InstalledInfo,
  InstallResult,
  ShareResult,
  StudioWidget,
} from '../shared/widgets.ts'
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
    forget: (deviceId) => ipcRenderer.invoke(IpcChannel.phonesForget, deviceId) as Promise<void>,
    setSplit: (phoneId, split) =>
      ipcRenderer.invoke(IpcChannel.phonesSetSplit, phoneId, split) as Promise<void>,
    setSource: (phoneId, source) =>
      ipcRenderer.invoke(IpcChannel.phonesSetSource, phoneId, source) as Promise<void>,
  },
  monitors: {
    get: () => ipcRenderer.invoke(IpcChannel.monitorsGet) as Promise<MonitorInfo[]>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, monitors: MonitorInfo[]) => listener(monitors)
      ipcRenderer.on(IpcChannel.monitorsChanged, handler)
      return () => ipcRenderer.off(IpcChannel.monitorsChanged, handler)
    },
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
  board: {
    get: () => ipcRenderer.invoke(IpcChannel.boardGet) as Promise<Board | null>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, board: Board | null) => listener(board)
      ipcRenderer.on(IpcChannel.boardChanged, handler)
      return () => ipcRenderer.off(IpcChannel.boardChanged, handler)
    },
    set: (board) => ipcRenderer.invoke(IpcChannel.boardSet, board) as Promise<void>,
  },
  widgets: {
    list: () => ipcRenderer.invoke(IpcChannel.widgetsList) as Promise<InstalledInfo[]>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, widgets: InstalledInfo[]) => listener(widgets)
      ipcRenderer.on(IpcChannel.widgetsChanged, handler)
      return () => ipcRenderer.off(IpcChannel.widgetsChanged, handler)
    },
    chooseFolder: () => ipcRenderer.invoke(IpcChannel.widgetsChooseFolder) as Promise<FolderCheck>,
    reload: (id) => ipcRenderer.invoke(IpcChannel.widgetsReload, id) as Promise<FolderCheck>,
    install: (token) =>
      ipcRenderer.invoke(IpcChannel.widgetsInstall, token) as Promise<InstallResult>,
    remove: (id) => ipcRenderer.invoke(IpcChannel.widgetsRemove, id) as Promise<void>,
    searchLocations: (id, query) =>
      ipcRenderer.invoke(IpcChannel.widgetsSearchLocations, id, query),
    cancelLocationSearch: (id) => ipcRenderer.invoke(IpcChannel.widgetsCancelLocationSearch, id),
    setConfig: (id, values) =>
      ipcRenderer.invoke(IpcChannel.widgetsSetConfig, id, values) as Promise<string[]>,
    setSecret: (id, name, value) =>
      ipcRenderer.invoke(IpcChannel.widgetsSetSecret, id, name, value) as Promise<string | null>,
    share: (id, notes) =>
      ipcRenderer.invoke(IpcChannel.widgetsShare, id, notes) as Promise<ShareResult>,
  },
  store: {
    check: (id) => ipcRenderer.invoke(IpcChannel.storeCheck, id) as Promise<FolderCheck>,
    onOpen: (listener) => {
      const handler = (_event: IpcRendererEvent, id: string) => listener(id)
      ipcRenderer.on(IpcChannel.storeOpen, handler)
      return () => ipcRenderer.off(IpcChannel.storeOpen, handler)
    },
    takeOpen: () => ipcRenderer.invoke(IpcChannel.storeTakeOpen) as Promise<string | null>,
  },
  studio: {
    get: (id) => ipcRenderer.invoke(IpcChannel.studioGet, id) as Promise<StudioWidget | null>,
    ids: () => ipcRenderer.invoke(IpcChannel.studioIds) as Promise<string[]>,
    save: (recipe: Recipe, id, author) =>
      ipcRenderer.invoke(IpcChannel.studioSave, recipe, id, author) as Promise<FolderCheck>,
  },
  generator: {
    models: () => ipcRenderer.invoke(IpcChannel.generatorModels) as Promise<GeneratorModels>,
    run: (prompt, model) =>
      ipcRenderer.invoke(IpcChannel.generatorRun, prompt, model) as Promise<GeneratorResult>,
    cancel: () => ipcRenderer.invoke(IpcChannel.generatorCancel) as Promise<void>,
  },
  account: {
    get: () => ipcRenderer.invoke(IpcChannel.accountGet) as Promise<AccountState>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: AccountState) => listener(state)
      ipcRenderer.on(IpcChannel.accountChanged, handler)
      return () => ipcRenderer.off(IpcChannel.accountChanged, handler)
    },
    signIn: () => ipcRenderer.invoke(IpcChannel.accountSignIn) as Promise<AccountState>,
    cancel: () => ipcRenderer.invoke(IpcChannel.accountCancel) as Promise<void>,
    signOut: () => ipcRenderer.invoke(IpcChannel.accountSignOut) as Promise<void>,
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannel.settingsGet) as Promise<AppSettings>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, settings: AppSettings) => listener(settings)
      ipcRenderer.on(IpcChannel.settingsChanged, handler)
      return () => ipcRenderer.off(IpcChannel.settingsChanged, handler)
    },
    set: (patch) => ipcRenderer.invoke(IpcChannel.settingsSet, patch) as Promise<AppSettings>,
  },
  window: {
    minimize: () => ipcRenderer.invoke(IpcChannel.windowMinimize) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IpcChannel.windowToggleMaximize) as Promise<void>,
    close: () => ipcRenderer.invoke(IpcChannel.windowClose) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IpcChannel.windowIsMaximized) as Promise<boolean>,
    onMaximizedChange: (listener) => {
      const handler = (_event: IpcRendererEvent, maximized: boolean) => listener(maximized)
      ipcRenderer.on(IpcChannel.windowMaximized, handler)
      return () => ipcRenderer.off(IpcChannel.windowMaximized, handler)
    },
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
