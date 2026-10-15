import type { CaptureEvent } from '../shared/capture.ts'
import type { DisplayState } from '../shared/display.ts'
import type { FirewallAllowResult, FirewallState, SettingsPage } from '../shared/firewall.ts'
import type { PairingState } from '../shared/pairing.ts'

/** The only surface the renderer gets: exposed as `window.shiftpane` by the preload script. */
export interface ShiftPaneApi {
  platform: 'windows' | 'macos' | 'linux'
  versions: { app: string; electron: string; chrome: string; node: string }
  pairing: {
    get(): Promise<PairingState>
    /** Calls `listener` on every change; returns an unsubscribe function. */
    onChange(listener: (state: PairingState) => void): () => void
    selectHost(address: string): Promise<void>
    newCode(): Promise<void>
    disconnect(phoneId: string): Promise<void>
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
