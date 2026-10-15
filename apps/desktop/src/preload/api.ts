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
}

declare global {
  interface Window {
    shiftpane: ShiftPaneApi
  }
}
