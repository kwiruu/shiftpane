import type { Board, MonitorInfo, MonitorSource, SplitName } from '@shiftpane/protocol'
import type { CaptureEvent } from '../shared/capture.ts'
import type { DisplayState } from '../shared/display.ts'
import type { FirewallAllowResult, FirewallState, SettingsPage } from '../shared/firewall.ts'
import type { PairingState } from '../shared/pairing.ts'
import type { AppSettings, FolderCheck, InstalledInfo, InstallResult } from '../shared/widgets.ts'

/** The only surface the renderer gets: exposed as `window.shiftpane` by the preload script. */
export interface ShiftPaneApi {
  platform: 'windows' | 'macos' | 'linux'
  versions: { app: string; electron: string; chrome: string; node: string }
  pairing: {
    get(): Promise<PairingState>
    /** Calls `listener` on every change; returns an unsubscribe function. */
    onChange(listener: (state: PairingState) => void): () => void
    selectHost(address: string): Promise<void>
    /** Replaces the QR code and the pairing code; phones already paired stay connected. */
    newCode(): Promise<void>
    /** Closes one connection; the phone keeps its key and can reconnect. */
    disconnect(phoneId: string): Promise<void>
    /** Drops a paired phone's key (a `RememberedPhone`'s `deviceId`); it has to pair again. */
    forget(deviceId: string): Promise<void>
    /** Switches one phone to a split (widgets only, 70 / 30, ...); the phone keeps it. */
    setSplit(phoneId: string, split: SplitName): Promise<void>
    /**
     * Switches what one phone's monitor area shows (the virtual monitor, or a copy of one of the
     * PC's monitors from `monitors`); the phone keeps it. A copy of a monitor that is not listed
     * is ignored.
     */
    setSource(phoneId: string, source: MonitorSource): Promise<void>
  }
  /** The PC's real monitors a phone can copy (not the virtual one), kept current. */
  monitors: {
    get(): Promise<MonitorInfo[]>
    /** Calls `listener` on every change; returns an unsubscribe function. */
    onChange(listener: (monitors: MonitorInfo[]) => void): () => void
  }
  /** Whether Windows Firewall lets phones reach the pairing server. Always "unknown" off Windows. */
  firewall: {
    get(): Promise<FirewallState>
    /** Calls `listener` on every change; returns an unsubscribe function. */
    onChange(listener: (state: FirewallState) => void): () => void
    /** Looks again, e.g. after the user changed something in Windows settings. */
    check(): Promise<void>
    /** Asks Windows (UAC prompt) to let phones on private networks reach ShiftPane. */
    allow(): Promise<FirewallAllowResult>
    openSettings(page: SettingsPage): Promise<void>
  }
  /**
   * The phones' widget board, which the PC keeps. Null until a phone or the editor made one.
   * A board set here goes to every connected phone.
   */
  board: {
    get(): Promise<Board | null>
    /** Calls `listener` on every change, from a phone or from here; returns an unsubscribe function. */
    onChange(listener: (board: Board | null) => void): () => void
    set(board: Board): Promise<void>
  }
  /**
   * Widgets installed on this PC, besides the built-in ones. Loading one from a folder takes
   * Developer mode; the main process picks the folder, so the window never names a path.
   */
  widgets: {
    list(): Promise<InstalledInfo[]>
    /** Calls `listener` on every change; returns an unsubscribe function. */
    onChange(listener: (widgets: InstalledInfo[]) => void): () => void
    /** Asks for a widget folder and checks it; nothing is installed until `install`. */
    chooseFolder(): Promise<FolderCheck>
    /** Checks an installed widget's folder again, to install what changed in it. */
    reload(id: string): Promise<FolderCheck>
    /** Installs a folder that was checked, once the user agreed to what it may do. */
    install(token: string): Promise<InstallResult>
    remove(id: string): Promise<void>
    /** Sets a widget's config; resolves with what was wrong, empty when it was set. */
    setConfig(id: string, values: Record<string, unknown>): Promise<string[]>
    /** Sets one of a widget's secrets, or clears it with null; resolves with why it couldn't. */
    setSecret(id: string, name: string, value: string | null): Promise<string | null>
  }
  settings: {
    get(): Promise<AppSettings>
    onChange(listener: (settings: AppSettings) => void): () => void
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  /** The window itself, for the title bar's own buttons (Windows and Linux draw no frame). */
  window: {
    minimize(): Promise<void>
    /** Maximizes, or restores a maximized window. */
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    /** Calls `listener` when the window is maximized or restored; returns an unsubscribe function. */
    onMaximizedChange(listener: (maximized: boolean) => void): () => void
  }
  /** The virtual monitor that follows the paired phone. */
  display: {
    get(): Promise<DisplayState>
    /** Calls `listener` on every change; returns an unsubscribe function. */
    onChange(listener: (state: DisplayState) => void): () => void
    /** Repeats what failed last (re-checks the driver, asks Windows for approval again). */
    retry(): Promise<void>
  }
  /**
   * The capture page's end of the stream to the phone. The main process picks the display and
   * relays the signaling; the page only ever gets commands for the one virtual monitor.
   */
  capture: {
    /** Calls `listener` for every command; the payload is unvalidated, parse it. */
    onCommand(listener: (command: unknown) => void): () => void
    send(event: CaptureEvent): void
  }
}

declare global {
  interface Window {
    shiftpane: ShiftPaneApi
  }
}
