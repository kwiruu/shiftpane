import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, session, shell } from 'electron'
import { z } from 'zod'
import {
  type FirewallAllowResult,
  type FirewallState,
  SETTINGS_PAGES,
  type SettingsPage,
} from '../shared/firewall.ts'
import { IpcChannel } from '../shared/pairing.ts'
import { FirewallMonitor } from './firewall/monitor.ts'
import { allowThroughFirewall, queryFirewall } from './firewall/powershell.ts'
import { PairingService } from './pairing.ts'

const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined
const platform =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let pairing: PairingService | null = null
let firewall: FirewallMonitor | null = null

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
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'ShiftPane',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
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
  })
  window.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function hardenSession(): void {
  // No camera, mic, notifications or geolocation for the local UI. Screen capture is
  // requested from the main process, not the renderer.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/** IPC is only accepted from our own window's top frame. */
function fromMainWindow(event: IpcMainInvokeEvent): boolean {
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

function registerIpc(service: PairingService): void {
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
  service.on('change', (state) => mainWindow?.webContents.send(IpcChannel.pairingChanged, state))
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
  void pairing.stop().finally(() => app.quit())
})

app.whenReady().then(() => {
  hardenSession()
  pairing = new PairingService({
    dataDir: app.getPath('userData'),
    // Packaged: copied in by electron-builder. Dev: the phone app's own build output.
    staticRoot: app.isPackaged
      ? join(process.resourcesPath, 'phone')
      : join(app.getAppPath(), '../phone/dist'),
    platform,
  })
  registerIpc(pairing)
  firewall = createFirewallMonitor()
  registerFirewallIpc(pairing, firewall)
  mainWindow = createWindow()
  void pairing.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})
