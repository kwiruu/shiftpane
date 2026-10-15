import {
  type BrowserWindow,
  type DesktopCapturerSource,
  desktopCapturer,
  type IpcMainEvent,
  ipcMain,
  type Session,
  screen,
  type WebContents,
} from 'electron'
import { type CaptureCommand, CaptureEvent } from '../../shared/capture.ts'
import { IpcChannel } from '../../shared/pairing.ts'
import type { DisplayController } from '../display/controller.ts'
import type { PhoneHub } from '../server/phone-hub.ts'
import { CaptureGate } from './gate.ts'
import { type CaptureBridge, StreamManager } from './manager.ts'
import { findCaptureSource } from './source.ts'

export interface StreamingOptions {
  display: DisplayController
  hub: PhoneHub
  session: Session
  getWindow: () => BrowserWindow | null
  /** Whether an IPC message came from the app window's top frame. */
  fromWindow: (event: IpcMainEvent) => boolean
  log?: (message: string) => void
}

export interface StreamingService {
  /**
   * For the session's permission handler: whether a `media` request is the app window asking
   * for the display the main process has armed. Nothing else is ever allowed through it.
   */
  allowsCapture(
    webContents: WebContents,
    permission: string,
    details: { isMainFrame: boolean; mediaTypes?: readonly string[] },
  ): boolean
  stop(): void
}

/**
 * Streams the virtual monitor to the paired phone: finds its capture source, hands it to the
 * app window's capture page, and relays the WebRTC signaling between the page and the phone.
 */
export function startStreaming(options: StreamingOptions): StreamingService {
  const { display, hub, session, getWindow, fromWindow } = options
  const log = options.log ?? ((message: string) => console.info(`[stream] ${message}`))
  const gate = new CaptureGate<DesktopCapturerSource>()

  // The page asks with getDisplayMedia; it gets the one source that was armed for it, or nothing.
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      const window = getWindow()
      const ours = window !== null && request.frame === window.webContents.mainFrame
      const source = ours && request.videoRequested && !request.audioRequested ? gate.take() : null
      if (!source) log('refused a screen capture request that was not armed')
      callback(source ? { video: source } : null)
    },
    { useSystemPicker: false },
  )

  const listeners = new Set<(event: CaptureEvent) => void>()
  const onEvent = (event: IpcMainEvent, payload: unknown) => {
    if (!fromWindow(event)) return
    const parsed = CaptureEvent.safeParse(payload)
    if (!parsed.success) {
      log('ignored an invalid message from the capture page')
      return
    }
    for (const listener of listeners) listener(parsed.data)
  }
  ipcMain.on(IpcChannel.captureEvent, onEvent)

  const bridge: CaptureBridge = {
    send(command: CaptureCommand) {
      const contents = getWindow()?.webContents
      if (!contents || contents.isDestroyed()) return
      // A command sent while the page is still loading would be lost: nobody listens yet.
      if (contents.isLoading()) {
        contents.once('did-finish-load', () => contents.send(IpcChannel.captureCommand, command))
      } else {
        contents.send(IpcChannel.captureCommand, command)
      }
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  const manager = new StreamManager({
    display,
    hub,
    bridge,
    log,
    arm: async (info) => {
      const { source } = await findCaptureSource(info, screen, desktopCapturer, { log })
      gate.arm(source)
    },
  })

  return {
    allowsCapture: (webContents, permission, details) => {
      const window = getWindow()
      return (
        permission === 'media' &&
        window !== null &&
        webContents === window.webContents &&
        details.isMainFrame &&
        // Display capture reports no media types; a camera or microphone request lists them.
        (details.mediaTypes ?? []).length === 0 &&
        gate.armed
      )
    },
    stop: () => {
      manager.stop()
      gate.clear()
      ipcMain.off(IpcChannel.captureEvent, onEvent)
      session.setDisplayMediaRequestHandler(null)
    },
  }
}
