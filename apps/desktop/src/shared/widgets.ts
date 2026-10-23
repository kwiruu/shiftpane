/** Installed widgets as the main process tells the desktop window about them. Types only. */

import type {
  ActionName,
  ConfigField,
  PermissionLine,
  SourceName,
  WidgetSize,
  WidgetView,
} from '@shiftpane/widget-sdk'
import type { MonitorScale } from './display.ts'
import type { Recipe } from './studio.ts'

export interface InstalledInfo {
  id: string
  name: string
  description: string
  version: string
  author: string
  license: string
  repository?: string
  sizes: WidgetSize[]
  view: WidgetView
  /** The collector's example output, for previews. */
  sample: Record<string, unknown>
  sources: SourceName[]
  actions: ActionName[]
  /** Everything it may do, in plain words. */
  permissions: PermissionLine[]
  /** It reads something that reveals what you do and can reach a host. */
  sendsOffPc: boolean
  hasCollector: boolean
  /** Seconds between collector runs. */
  refreshSeconds: number
  config: { fields: ConfigField[]; values: Record<string, string | number | boolean> }
  /** Each secret it declares, and whether one is set. The values never leave the main process. */
  secrets: { name: string; set: boolean }[]
  /** False where the OS has no keychain to keep secrets in. */
  secretsAvailable: boolean
  origin:
    | { kind: 'folder'; path: string }
    | { kind: 'marketplace'; version: string; sha256: string }
  /** Why the marketplace withdrew this version, when it did; the widget no longer runs. */
  revoked: string | null
  /** A newer version the marketplace has, which this app can run. */
  update: string | null
  installedAt: number
  updatedAt: number
  /** How its collector did last time, while some phone shows it. */
  status: { lastRunAt: number | null; problem: string | null }
}

/**
 * A widget checked before anything is installed: a folder picked in Developer mode, or a version
 * from the marketplace. `folder` is where it comes from, to show.
 */
export type FolderCheck =
  | { status: 'canceled' }
  | { status: 'invalid'; folder: string; problems: string[] }
  | {
      status: 'ready'
      from: 'folder' | 'marketplace'
      /** Hand this to `install` to go ahead. */
      token: string
      folder: string
      widget: {
        id: string
        name: string
        version: string
        author: string
        description: string
        hasCollector: boolean
      }
      permissions: PermissionLine[]
      sendsOffPc: boolean
      /** Set when a version of this widget is installed: what this one adds. */
      replaces: { version: string; added: PermissionLine[] } | null
    }

export type InstallResult = { ok: true; id: string } | { ok: false; problem: string }

/** Signing in to the marketplace, to share widgets from this app. */
export type AccountState =
  | { status: 'signed-out'; problem?: string }
  | { status: 'waiting'; userCode: string; verificationUri: string; expiresAt: number }
  | { status: 'signed-in'; login: string }

export type ShareResult =
  | { ok: true; status: string; widgetId: string; version: string }
  | { ok: false; problems: string[] }

/** App-wide settings the desktop window changes. */
export interface AppSettings {
  /** Shows the tools for making widgets, such as loading one from a folder. */
  developerMode: boolean
  /** The local model Widget Studio's generator asks, by its Ollama name; null picks one. */
  generatorModel: string | null
  /** The OS scale of the phone's monitor. */
  monitorScale: MonitorScale
}

export const DEFAULT_SETTINGS: AppSettings = {
  developerMode: false,
  generatorModel: null,
  monitorScale: 'phone',
}

/** The local models Widget Studio's generator can ask, from Ollama on this PC. */
export type GeneratorModels =
  | { ok: true; models: string[]; preferred: string | null }
  | { ok: false; problem: string }

export type GeneratorResult = { ok: true; recipe: Recipe } | { ok: false; problem: string }

/** A widget Studio made, to edit again: its recipe and the author it was saved with. */
export interface StudioWidget {
  id: string
  recipe: Recipe
  author: string
}
