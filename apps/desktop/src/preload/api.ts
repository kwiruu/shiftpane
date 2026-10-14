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
}

declare global {
  interface Window {
    shiftpane: ShiftPaneApi
  }
}
