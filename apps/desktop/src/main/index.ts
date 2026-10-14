import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'

const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined

if (!app.requestSingleInstanceLock()) {
  app.quit()
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

ipcMain.on('app:version', (event) => {
  event.returnValue = app.getVersion()
})

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (window) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(() => {
  hardenSession()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
