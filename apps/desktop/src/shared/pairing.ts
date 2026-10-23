/** Pairing state the main process pushes to the desktop window. Types only: shared by main, preload and renderer. */

import type { ScreenReport } from '@shiftpane/protocol'

export interface LanHost {
  address: string
  interface: string
}

export interface ConnectedPhone {
  /** This connection; a phone that reconnects gets a new one. */
  id: string
  /** The paired phone, the same on every connection: a `RememberedPhone`'s `deviceId`. */
  deviceId: string
  name: string
  address: string
  viewport: { width: number; height: number }
  devicePixelRatio: number
  connectedAt: number
  /** How the phone's screen is laid out now (size, split, safe area); null until it says. */
  screen: ScreenReport | null
}

/** A phone this PC paired, which it lets back in with its saved key until told to forget it. */
export interface RememberedPhone {
  deviceId: string
  name: string
  pairedAt: number
  lastSeenAt: number
}

/** The six digits to type on a phone that cannot follow the QR code's link. */
export interface PairingCodeState {
  digits: string
  expiresAt: number
  /** Too many wrong tries: no code is taken until the next one. */
  locked: boolean
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
      code: PairingCodeState
      phones: ConnectedPhone[]
      /** Every paired phone, connected or not, most recently seen first. */
      remembered: RememberedPhone[]
    }

/** IPC channel names, so main and preload cannot drift apart. */
export const IpcChannel = {
  appVersion: 'app:version',
  pairingGet: 'pairing:get',
  pairingSelectHost: 'pairing:select-host',
  pairingNewCode: 'pairing:new-code',
  pairingChanged: 'pairing:changed',
  phonesDisconnect: 'phones:disconnect',
  phonesForget: 'phones:forget',
  phonesSetSplit: 'phones:set-split',
  phonesSetSource: 'phones:set-source',
  monitorsGet: 'monitors:get',
  monitorsChanged: 'monitors:changed',
  firewallGet: 'firewall:get',
  firewallChanged: 'firewall:changed',
  firewallCheck: 'firewall:check',
  firewallAllow: 'firewall:allow',
  firewallOpenSettings: 'firewall:open-settings',
  displayGet: 'display:get',
  displayChanged: 'display:changed',
  displayRetry: 'display:retry',
  captureCommand: 'capture:command',
  captureEvent: 'capture:event',
  boardGet: 'board:get',
  boardSet: 'board:set',
  boardChanged: 'board:changed',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximized: 'window:maximized',
  widgetsList: 'widgets:list',
  widgetsChanged: 'widgets:changed',
  widgetsChooseFolder: 'widgets:choose-folder',
  widgetsReload: 'widgets:reload',
  widgetsInstall: 'widgets:install',
  widgetsRemove: 'widgets:remove',
  widgetsSetConfig: 'widgets:set-config',
  widgetsSetSecret: 'widgets:set-secret',
  widgetsShare: 'widgets:share',
  storeCheck: 'store:check',
  storeOpen: 'store:open',
  storeTakeOpen: 'store:take-open',
  studioGet: 'studio:get',
  studioIds: 'studio:ids',
  studioSave: 'studio:save',
  generatorModels: 'generator:models',
  generatorRun: 'generator:run',
  generatorCancel: 'generator:cancel',
  accountGet: 'account:get',
  accountChanged: 'account:changed',
  accountSignIn: 'account:sign-in',
  accountCancel: 'account:cancel',
  accountSignOut: 'account:sign-out',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
} as const
