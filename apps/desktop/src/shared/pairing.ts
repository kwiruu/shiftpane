/** Pairing state the main process pushes to the desktop window. Types only: shared by main, preload and renderer. */

export interface LanHost {
  address: string
  interface: string
}

export interface ConnectedPhone {
  id: string
  name: string
  address: string
  viewport: { width: number; height: number }
  devicePixelRatio: number
  connectedAt: number
}

export type PairingState =
  | { status: 'starting' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      /** Full pairing URL including the token. Only ever shown as a QR code or copied by the user. */
      url: string
      qrSvg: string
      host: string
      hosts: LanHost[]
      port: number
      /** SHA-256 fingerprint of the self-signed certificate, for the user to compare on the phone. */
      fingerprint: string
      phones: ConnectedPhone[]
    }

/** IPC channel names, so main and preload cannot drift apart. */
export const IpcChannel = {
  appVersion: 'app:version',
  pairingGet: 'pairing:get',
  pairingSelectHost: 'pairing:select-host',
  pairingNewCode: 'pairing:new-code',
  pairingChanged: 'pairing:changed',
  phonesDisconnect: 'phones:disconnect',
  firewallGet: 'firewall:get',
  firewallChanged: 'firewall:changed',
  firewallCheck: 'firewall:check',
  firewallAllow: 'firewall:allow',
  firewallOpenSettings: 'firewall:open-settings',
} as const
