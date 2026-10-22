import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { Board, SplitName } from '@shiftpane/protocol'
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  safeStorage,
  session,
  shell,
} from 'electron'
import { z } from 'zod'
import {
  type FirewallAllowResult,
  type FirewallState,
  SETTINGS_PAGES,
  type SettingsPage,
} from '../shared/firewall.ts'
import { IpcChannel } from '../shared/pairing.ts'
import type { FolderCheck } from '../shared/widgets.ts'
import { BoardService, EDITOR } from './board/service.ts'
import {
  bindDisplayToHub,
  createDisplayController,
  createHelperHost,
  type DisplayController,
} from './display/index.ts'
import { FirewallMonitor } from './firewall/monitor.ts'
import { allowThroughFirewall, queryFirewall } from './firewall/powershell.ts'
import { PairingService } from './pairing.ts'
import { SettingsService } from './settings.ts'
import { fileStorage } from './storage.ts'
import { acceptSource } from './stream/monitors.ts'
import { type StreamingService, startStreaming } from './stream/service.ts'
import { startWidgets, type Widgets } from './widgets/index.ts'

const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined
const platform =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// WebRTC hides this PC's LAN addresses behind random `.local` names, which the phone could only
// resolve over multicast DNS, and the firewall rule this app adds lets in TCP only. A phone is
// paired with the QR code on this screen, so the PC puts its real addresses in its candidates.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

let mainWindow: BrowserWindow | null = null
let pairing: PairingService | null = null
let firewall: FirewallMonitor | null = null
let display: DisplayController | null = null
let streaming: StreamingService | null = null
let widgets: Widgets | null = null
let settings: SettingsService | null = null
let board: BoardService | null = null

const UNKNOWN_FIREWALL: FirewallState = { status: 'unknown' }
const SettingsPageSchema = z.enum(SETTINGS_PAGES)
const SETTINGS_URLS: Record<SettingsPage, string> = {
  // Network & internet, where the connected network's "Properties" sets Public or Private.
  network: 'ms-settings:network-status',
  // Windows Security > Firewall & network protection.
  firewall: 'windowsdefender://network/',
}

/** Windows only: whether the firewall lets phones reach the pairing server. */
function createFirewallMonitor(): FirewallMonitor | null {
  if (process.platform !== 'win32') return null
  // Rules match the executable's real path, not a junction to it (pnpm's node_modules in dev).
  let program = process.execPath
  try {
    program = realpathSync.native(program)
  } catch {
    // Keep execPath.
  }
  return new FirewallMonitor({
    program,
    env: process.env,
    query: () => queryFirewall(),
    allow: () => allowThroughFirewall(program),
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    // The phone layout editor needs its three columns.
    minWidth: 980,
    minHeight: 560,
    show: false,
    title: 'ShiftPane',
    backgroundColor: '#121214',
    // The window draws its own title bar and buttons; macOS keeps its traffic lights.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : { frame: false }),
    // Unpackaged runs show the app's icon too; packaged apps take it from the executable.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build/icon.png') }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // This page also captures and encodes the monitor for the phone; minimized or covered, it
      // must keep running at full speed.
      backgroundThrottling: false,
    },
  })

  window.once('ready-to-show', () => window.show())

  // The renderer never navigates; external links open in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  // Coming back from Windows settings (network type, firewall) is the moment to look again.
  window.on('focus', () => {
    if (firewall?.state.status === 'blocked') void firewall.check()
    // Coming back after installing the display driver. Only those two problems are re-checked
    // on focus: retrying anything else could bring a UAC prompt straight back.
    const problem = display?.state
    if (
      problem?.status === 'problem' &&
      (problem.reason === 'driver-missing' || problem.reason === 'helper-missing')
    ) {
      void display?.recheck()
    }
  })
  window.on('closed', () => {
    mainWindow = null
  })
  // The title bar shows restore instead of maximize while the window fills the screen.
  const sendMaximized = () =>
    window.webContents.send(IpcChannel.windowMaximized, window.isMaximized())
  window.on('maximize', sendMaximized)
  window.on('unmaximize', sendMaximized)

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function hardenSession(): void {
  // No camera, mic, notifications or geolocation for the local UI. The one exception is the
  // window asking for the virtual monitor's screen while the main process has armed exactly
  // that source for it (see stream/service.ts); the main process also picks the source.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(streaming?.allowsCapture(webContents, permission, details) ?? false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/** IPC is only accepted from our own window's top frame. */
function fromMainWindow(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === event.sender.mainFrame
  )
}

function registerFirewallIpc(service: PairingService, monitor: FirewallMonitor | null): void {
  ipcMain.handle(IpcChannel.firewallGet, (event) =>
    fromMainWindow(event) ? (monitor?.state ?? UNKNOWN_FIREWALL) : null,
  )
  ipcMain.handle(IpcChannel.firewallCheck, async (event) => {
    if (fromMainWindow(event)) await monitor?.check()
  })
  // Takes no arguments: nothing from the renderer reaches the elevated command.
  ipcMain.handle(IpcChannel.firewallAllow, (event): Promise<FirewallAllowResult> | 'failed' =>
    fromMainWindow(event) && monitor ? monitor.allow() : 'failed',
  )
  ipcMain.handle(IpcChannel.firewallOpenSettings, async (event, page: unknown) => {
    const parsed = SettingsPageSchema.safeParse(page)
    if (fromMainWindow(event) && parsed.success && monitor) {
      await shell.openExternal(SETTINGS_URLS[parsed.data])
    }
  })
  if (!monitor) return
  monitor.on('change', (state) => mainWindow?.webContents.send(IpcChannel.firewallChanged, state))
  // Phones connect to the advertised address on the server's actual port.
  service.on('change', (state) => {
    if (state.status !== 'ready') return
    const advertised = state.hosts.find((host) => host.address === state.host)
    if (advertised) monitor.setTarget({ port: state.port, interfaceAlias: advertised.interface })
  })
}

function registerDisplayIpc(controller: DisplayController): void {
  ipcMain.handle(IpcChannel.displayGet, (event) =>
    fromMainWindow(event) ? controller.state : null,
  )
  // Takes no arguments: nothing from the renderer reaches the helper.
  ipcMain.handle(IpcChannel.displayRetry, async (event) => {
    if (fromMainWindow(event)) await controller.retry()
  })
  controller.on('change', (state) => mainWindow?.webContents.send(IpcChannel.displayChanged, state))
}

/** The title bar's own minimize, maximize and close buttons. None of them take arguments. */
function registerWindowIpc(): void {
  ipcMain.handle(IpcChannel.windowMinimize, (event) => {
    if (fromMainWindow(event)) mainWindow?.minimize()
  })
  ipcMain.handle(IpcChannel.windowToggleMaximize, (event) => {
    if (!fromMainWindow(event) || !mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle(IpcChannel.windowClose, (event) => {
    if (fromMainWindow(event)) mainWindow?.close()
  })
  ipcMain.handle(IpcChannel.windowIsMaximized, (event) =>
    fromMainWindow(event) ? (mainWindow?.isMaximized() ?? false) : false,
  )
}

function registerBoardIpc(service: BoardService): void {
  ipcMain.handle(IpcChannel.boardGet, (event) => (fromMainWindow(event) ? service.current() : null))
  // The editor's board is checked like a phone's before it is kept or sent anywhere.
  ipcMain.handle(IpcChannel.boardSet, (event, value: unknown) => {
    const parsed = Board.safeParse(value)
    if (fromMainWindow(event) && parsed.success) service.set(parsed.data, EDITOR)
  })
  // The window already shows its own edits; sending them back would undo a drag in progress.
  service.on('change', (value, from) => {
    if (from !== EDITOR) mainWindow?.webContents.send(IpcChannel.boardChanged, value)
  })
}

const WidgetId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64)
const NOT_DEVELOPER: FolderCheck = {
  status: 'invalid',
  folder: '',
  problems: ['Turn on Developer mode in Settings to load widgets from a folder.'],
}

/**
 * Installed widgets and the settings that unlock loading them from a folder. Paths never come
 * from the window: the main process asks for the folder itself, and a reload uses the folder the
 * widget was loaded from.
 */
function registerWidgetIpc(installed: Widgets['installed'], appSettings: SettingsService): void {
  const developer = async () => (await appSettings.get()).developerMode
  ipcMain.handle(IpcChannel.settingsGet, (event) =>
    fromMainWindow(event) ? appSettings.get() : null,
  )
  ipcMain.handle(IpcChannel.settingsSet, (event, patch: unknown) => {
    if (!fromMainWindow(event) || typeof patch !== 'object' || patch === null) return null
    return appSettings.set(patch)
  })
  appSettings.on('change', (value) =>
    mainWindow?.webContents.send(IpcChannel.settingsChanged, value),
  )

  ipcMain.handle(IpcChannel.widgetsList, (event) => (fromMainWindow(event) ? installed.list() : []))
  ipcMain.handle(IpcChannel.widgetsChooseFolder, async (event): Promise<FolderCheck> => {
    if (!fromMainWindow(event) || !mainWindow) return { status: 'canceled' }
    if (!(await developer())) return NOT_DEVELOPER
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Load a widget folder',
      buttonLabel: 'Check this widget',
      properties: ['openDirectory'],
    })
    const folder = picked.filePaths[0]
    if (picked.canceled || !folder) return { status: 'canceled' }
    return installed.check(folder)
  })
  ipcMain.handle(IpcChannel.widgetsReload, async (event, id: unknown): Promise<FolderCheck> => {
    const parsed = WidgetId.safeParse(id)
    if (!fromMainWindow(event) || !parsed.success) return { status: 'canceled' }
    if (!(await developer())) return NOT_DEVELOPER
    const origin = installed.origin(parsed.data)
    if (!origin) return { status: 'canceled' }
    return installed.check(origin.path)
  })
  ipcMain.handle(IpcChannel.widgetsInstall, (event, token: unknown) => {
    if (!fromMainWindow(event) || typeof token !== 'string') {
      return { ok: false, problem: 'Nothing to install.' }
    }
    return installed.install(token)
  })
  ipcMain.handle(IpcChannel.widgetsRemove, async (event, id: unknown) => {
    const parsed = WidgetId.safeParse(id)
    if (fromMainWindow(event) && parsed.success) await installed.remove(parsed.data)
  })
  ipcMain.handle(IpcChannel.widgetsSetConfig, (event, id: unknown, values: unknown) => {
    const parsed = WidgetId.safeParse(id)
    if (!fromMainWindow(event) || !parsed.success || typeof values !== 'object' || !values) {
      return ['Nothing to set.']
    }
    return installed.setConfig(parsed.data, values as Record<string, unknown>)
  })
  ipcMain.handle(
    IpcChannel.widgetsSetSecret,
    (event, id: unknown, name: unknown, value: unknown) => {
      const parsed = WidgetId.safeParse(id)
      if (
        !fromMainWindow(event) ||
        !parsed.success ||
        typeof name !== 'string' ||
        (typeof value !== 'string' && value !== null) ||
        (typeof value === 'string' && value.length > 4096)
      ) {
        return 'Nothing to set.'
      }
      return installed.setSecret(parsed.data, name, value)
    },
  )
  const push = () => mainWindow?.webContents.send(IpcChannel.widgetsChanged, installed.list())
  installed.on('installed', push)
  installed.on('status', push)
}

function registerIpc(service: PairingService, monitors: StreamingService['monitors']): void {
  ipcMain.handle(IpcChannel.pairingGet, (event) => (fromMainWindow(event) ? service.state : null))
  ipcMain.handle(IpcChannel.pairingSelectHost, async (event, address: unknown) => {
    if (fromMainWindow(event) && typeof address === 'string') await service.selectHost(address)
  })
  ipcMain.handle(IpcChannel.pairingNewCode, async (event) => {
    if (fromMainWindow(event)) await service.newCode()
  })
  ipcMain.handle(IpcChannel.phonesDisconnect, (event, phoneId: unknown) => {
    if (fromMainWindow(event) && typeof phoneId === 'string') service.hub.disconnect(phoneId)
  })
  ipcMain.handle(IpcChannel.phonesForget, (event, deviceId: unknown) => {
    if (fromMainWindow(event) && typeof deviceId === 'string') service.forget(deviceId)
  })
  // A split is picked by name and checked like any frame before it goes to a phone.
  ipcMain.handle(IpcChannel.phonesSetSplit, (event, phoneId: unknown, split: unknown) => {
    const parsed = SplitName.safeParse(split)
    if (fromMainWindow(event) && typeof phoneId === 'string' && parsed.success) {
      service.hub.send(phoneId, { type: 'split.set', split: parsed.data })
    }
  })
  // What a phone's monitor area shows is picked the same way, and checked the same way. A copy
  // has to be of a monitor that is listed now, which also keeps the virtual monitor out of it.
  ipcMain.handle(IpcChannel.phonesSetSource, (event, phoneId: unknown, source: unknown) => {
    const accepted = acceptSource(source, monitors.list())
    if (fromMainWindow(event) && typeof phoneId === 'string' && accepted) {
      service.hub.send(phoneId, { type: 'source.set', source: accepted })
    }
  })
  service.on('change', (state) => mainWindow?.webContents.send(IpcChannel.pairingChanged, state))
}

function registerMonitorIpc(monitors: StreamingService['monitors']): void {
  ipcMain.handle(IpcChannel.monitorsGet, (event) =>
    fromMainWindow(event) ? monitors.list() : null,
  )
  monitors.onChange((list) => mainWindow?.webContents.send(IpcChannel.monitorsChanged, list))
}

ipcMain.on(IpcChannel.appVersion, (event) => {
  event.returnValue = app.getVersion()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let stopping = false
app.on('before-quit', (event) => {
  if (stopping || !pairing) return
  stopping = true
  event.preventDefault()
  // Phones first, so nothing asks for a monitor while it is being removed.
  streaming?.stop()
  widgets?.stop()
  board?.stop()
  void pairing
    .stop()
    .then(() => board?.flush())
    .then(() => display?.stop())
    .finally(() => app.quit())
})

app.whenReady().then(() => {
  hardenSession()
  const helper = createHelperHost({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
  display = createDisplayController(helper)
  const controller = display
  pairing = new PairingService({
    dataDir: app.getPath('userData'),
    // Packaged: copied in by electron-builder. Dev: the phone app's own build output.
    staticRoot: app.isPackaged
      ? join(process.resourcesPath, 'phone')
      : join(app.getAppPath(), '../phone/dist'),
    platform,
    displayAvailable: () => controller.available,
    log: (message) => console.info(`[pairing] ${message}`),
  })
  bindDisplayToHub(controller, pairing.hub)
  streaming = startStreaming({
    display: controller,
    hub: pairing.hub,
    session: session.defaultSession,
    getWindow: () => mainWindow,
    fromWindow: fromMainWindow,
  })
  widgets = startWidgets({
    hub: pairing.hub,
    helper: async () => (await helper.session()).channel,
    dataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    cipher: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (data) => safeStorage.decryptString(data),
    },
  })
  settings = new SettingsService(fileStorage(join(app.getPath('userData'), 'settings.json')))
  board = new BoardService({
    hub: pairing.hub,
    storage: fileStorage(join(app.getPath('userData'), 'board.json')),
    log: (message) => console.info(`[board] ${message}`),
  })
  registerIpc(pairing, streaming.monitors)
  registerMonitorIpc(streaming.monitors)
  registerWindowIpc()
  registerBoardIpc(board)
  registerWidgetIpc(widgets.installed, settings)
  registerDisplayIpc(controller)
  firewall = createFirewallMonitor()
  registerFirewallIpc(pairing, firewall)
  mainWindow = createWindow()
  void pairing.start()
  void controller.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})
