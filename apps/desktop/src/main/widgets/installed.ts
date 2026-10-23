import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  InstalledWidget,
  InstalledWidgetData,
  PcMessage,
  PhoneMessage,
} from '@shiftpane/protocol'
import {
  guardedFetch,
  type HostFetch,
  type PackageTexts,
  type RunResult,
  readWidgetFolder,
  runCollector,
} from '@shiftpane/widget-runtime'
import {
  type ActionName,
  addedPermissions,
  canSendOffPc,
  compareVersions,
  describePermissions,
  type JsonValue,
  type Permissions,
  readPackage,
  reservedIds,
  type WidgetPackage,
} from '@shiftpane/widget-sdk'
import type { FolderCheck, InstalledInfo, InstallResult } from '../../shared/widgets.ts'
import type { PhoneHub, PhoneInfo } from '../server/phone-hub.ts'
import type { WidgetSecrets } from './secrets.ts'
import type { WidgetCollector } from './service.ts'
import type { SourceReader } from './sources.ts'
import { effectiveConfig, type InstalledEntry, type InstalledStore, type Origin } from './store.ts'

/** Seconds between runs of a collector whose manifest doesn't say. */
const DEFAULT_REFRESH_SECONDS = 60
/** A collector that reaches hosts runs at most this often, whatever its manifest says. */
const MIN_HOST_REFRESH_SECONDS = 30
/** How long a checked folder waits to be installed. */
const PENDING_MS = 10 * 60_000

interface RunState {
  output: Record<string, JsonValue> | null
  problem: string | null
  lastRunAt: number | null
  running: Promise<void> | null
}

interface Pending {
  widget: WidgetPackage
  texts: PackageTexts
  origin: Origin
  expires: number
}

/** What the marketplace says about an installed widget. */
export interface StoreNote {
  /** Why this version was withdrawn; it no longer runs. */
  revoked?: string
  /** A newer version this app can run. */
  update?: string
}

export interface InstalledWidgetsOptions {
  store: InstalledStore
  secrets: WidgetSecrets
  sources: SourceReader
  hub: Pick<PhoneHub, 'on' | 'off' | 'send' | 'phones'>
  /** This app's version, for a widget's `minAppVersion`. */
  appVersion: string
  run?: typeof runCollector
  fetchFor?: (permissions: Permissions) => HostFetch
  /** Presses a button on the PC: a media key, or the volume. */
  press?: (action: ActionName, value?: number) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

/** A collector's refresh, as the app runs it. */
export function refreshSeconds(entry: Pick<InstalledEntry, 'widget'>): number {
  const { refreshSeconds: asked, permissions } = entry.widget.manifest
  const reachesHosts = permissions.network.length > 0 || permissions.local.length > 0
  return Math.max(asked ?? DEFAULT_REFRESH_SECONDS, reachesHosts ? MIN_HOST_REFRESH_SECONDS : 1)
}

/**
 * The widgets installed on this PC, from the marketplace or (in Developer mode) a folder.
 *
 * Phones learn what each looks like (`widgets.installed`) when they connect and whenever the list
 * changes. Each widget gets a collector for the widget service, which runs it while a phone
 * shows it: its sources are read every couple of seconds, its collector.js runs in the sandbox
 * every `refreshSeconds`, one run at a time across all widgets.
 *
 * `installed` fires when the list or a widget's config changes (phones and collectors follow it),
 * `status` when a collector run finished, and `added` when the user installs one, saying whether it
 * is new to this PC or an update.
 */
export class InstalledWidgets extends EventEmitter<{
  installed: []
  status: []
  added: [{ id: string; origin: Origin; first: boolean }]
  /** A button on this widget was pressed; what it shows may have changed. */
  pressed: [string]
}> {
  readonly #options: InstalledWidgetsOptions
  readonly #log: (message: string) => void
  readonly #runs = new Map<string, RunState>()
  readonly #pending = new Map<string, Pending>()
  readonly #collectors = new Map<string, { entry: InstalledEntry; collector: WidgetCollector }>()
  readonly #greeted = new Set<string>()
  readonly #unhook: Array<() => void> = []
  #notes = new Map<string, StoreNote>()
  #queue: Promise<unknown> = Promise.resolve()
  #started: Promise<void> | null = null

  constructor(options: InstalledWidgetsOptions) {
    super()
    this.#options = options
    this.#log = options.log ?? (() => {})
    const { hub } = options
    const onChange = (phones: PhoneInfo[]) => this.#greet(phones)
    const onMessage = (_phone: PhoneInfo, message: PhoneMessage) => {
      if (message.type === 'widget.action') {
        void this.press(message.widget, message.action, message.value)
      }
    }
    hub.on('change', onChange)
    hub.on('message', onMessage)
    this.#unhook.push(
      () => hub.off('change', onChange),
      () => hub.off('message', onMessage),
    )
  }

  /** Reads what is installed. Phones that connect before it has finished get the list after. */
  start(): Promise<void> {
    this.#started ??= (async () => {
      await this.#options.secrets.load()
      await this.#options.store.load()
      this.emit('installed')
      this.#sendToPhones()
    })()
    return this.#started
  }

  stop(): void {
    for (const unhook of this.#unhook.splice(0)) unhook()
  }

  #now(): number {
    return (this.#options.now ?? Date.now)()
  }

  // -------------------------------------------------------------------------------------
  // phones
  // -------------------------------------------------------------------------------------

  /** What a phone needs to draw each installed widget. */
  views(): InstalledWidget[] {
    return this.#options.store.list().map(({ widget }) => ({
      id: widget.manifest.id,
      name: widget.manifest.name,
      version: widget.manifest.version,
      sizes: widget.manifest.sizes,
      actions: widget.manifest.permissions.actions,
      view: widget.view,
    }))
  }

  #message(): Extract<PcMessage, { type: 'widgets.installed' }> {
    return { type: 'widgets.installed', widgets: this.views() }
  }

  #greet(phones: PhoneInfo[]): void {
    const present = new Set(phones.map((phone) => phone.id))
    for (const id of this.#greeted) if (!present.has(id)) this.#greeted.delete(id)
    for (const phone of phones) {
      if (this.#greeted.has(phone.id)) continue
      this.#greeted.add(phone.id)
      void this.start().then(() => {
        if (this.#greeted.has(phone.id)) this.#options.hub.send(phone.id, this.#message())
      })
    }
  }

  #sendToPhones(): void {
    const message = this.#message()
    for (const phone of this.#options.hub.phones) this.#options.hub.send(phone.id, message)
  }

  #changed(): void {
    this.emit('installed')
    this.#sendToPhones()
  }

  // -------------------------------------------------------------------------------------
  // collecting
  // -------------------------------------------------------------------------------------

  /**
   * One collector per installed widget, for the widget service. A widget's collector stays the
   * same object until the widget or its config changes, so the service only restarts that one.
   */
  collectors(): Record<string, WidgetCollector> {
    const result: Record<string, WidgetCollector> = {}
    const current = new Set<string>()
    for (const entry of this.#options.store.list()) {
      current.add(entry.id)
      const known = this.#collectors.get(entry.id)
      if (known?.entry === entry) {
        result[entry.id] = known.collector
        continue
      }
      const declared = entry.widget.manifest.permissions.sources
      const collector: WidgetCollector = {
        // Sources move every second or so; output only changes when the collector runs.
        intervalMs:
          declared.length > 0 ? 2000 : entry.widget.collector !== undefined ? 5000 : 60_000,
        onlyOnChange: true,
        collect: () => this.#collect(entry),
      }
      this.#collectors.set(entry.id, { entry, collector })
      result[entry.id] = collector
    }
    for (const id of this.#collectors.keys()) if (!current.has(id)) this.#collectors.delete(id)
    return result
  }

  #run(id: string): RunState {
    let state = this.#runs.get(id)
    if (!state) {
      state = { output: null, problem: null, lastRunAt: null, running: null }
      this.#runs.set(id, state)
    }
    return state
  }

  async #collect(entry: InstalledEntry): Promise<InstalledWidgetData> {
    const { manifest, collector } = entry.widget
    const sources = await this.#options.sources.read(manifest.permissions.sources)
    const config = effectiveConfig(entry)
    const data = (output: Record<string, JsonValue> | null, problem: string | null) =>
      ({ sources, output, config, problem }) as InstalledWidgetData

    const revoked = this.#notes.get(entry.id)?.revoked
    if (revoked !== undefined) {
      return {
        sources: {},
        output: null,
        config,
        problem: `Withdrawn from the marketplace: ${revoked}`.slice(0, 256),
      } as InstalledWidgetData
    }

    if (collector === undefined) return data({}, null)

    const missing = manifest.config.find(
      (field) => field.required && !Object.hasOwn(config, field.key),
    )
    if (missing)
      return data(null, `Set "${missing.label}" for this widget in ShiftPane on your PC.`)

    const state = this.#run(entry.id)
    const due =
      state.lastRunAt === null || this.#now() - state.lastRunAt >= refreshSeconds(entry) * 1000
    if (due && !state.running) {
      const sandboxSources = sources as Record<string, unknown>
      state.running = this.#enqueue(() => this.#runCollector(entry, sandboxSources, config)).then(
        (result) => {
          state.lastRunAt = this.#now()
          if (result.ok) {
            state.output = result.output
            state.problem = null
          } else {
            state.problem = `Couldn't update: ${result.error}`.slice(0, 256)
            this.#log(`${entry.id}: ${result.error}`)
          }
          state.running = null
          this.emit('status')
        },
      )
    }
    // The first run is waited for, so a phone doesn't sit on "waiting" for a whole interval.
    if (state.output === null && state.running) await state.running
    return data(state.output, state.output === null ? state.problem : null)
  }

  #enqueue(work: () => Promise<RunResult>): Promise<RunResult> {
    const next = this.#queue.catch(() => {}).then(work)
    this.#queue = next
    return next
  }

  #runCollector(
    entry: InstalledEntry,
    sources: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<RunResult> {
    const { manifest, collector = '' } = entry.widget
    const fetchFor = this.#options.fetchFor ?? ((permissions) => guardedFetch(permissions))
    return (this.#options.run ?? runCollector)({
      code: collector,
      config,
      secrets: this.#options.secrets.read(entry.id, manifest.permissions.secrets),
      sources,
      fetch: fetchFor(manifest.permissions),
      log: (message) => this.#log(`${entry.id}: ${message}`),
    })
  }

  // -------------------------------------------------------------------------------------
  // the desktop window
  // -------------------------------------------------------------------------------------

  list(): InstalledInfo[] {
    const { secrets } = this.#options
    return this.#options.store.list().map((entry) => {
      const { manifest, view, sample, collector } = entry.widget
      const set = new Set(secrets.names(entry.id))
      const run = this.#runs.get(entry.id)
      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
        license: manifest.license,
        ...(manifest.repository && { repository: manifest.repository }),
        sizes: manifest.sizes,
        view,
        sample,
        sources: manifest.permissions.sources,
        actions: manifest.permissions.actions,
        permissions: describePermissions(manifest.permissions),
        sendsOffPc: canSendOffPc(manifest.permissions),
        hasCollector: collector !== undefined,
        refreshSeconds: refreshSeconds(entry),
        config: { fields: manifest.config, values: effectiveConfig(entry) },
        secrets: manifest.permissions.secrets.map((name) => ({ name, set: set.has(name) })),
        secretsAvailable: secrets.available,
        origin: entry.origin,
        revoked: this.#notes.get(entry.id)?.revoked ?? null,
        update: this.#notes.get(entry.id)?.update ?? null,
        installedAt: entry.installedAt,
        updatedAt: entry.updatedAt,
        status: { lastRunAt: run?.lastRunAt ?? null, problem: run?.problem ?? null },
      }
    })
  }

  /** Reads and checks a widget folder, and holds it for `install` if it can be installed. */
  async check(folder: string): Promise<FolderCheck> {
    const { files, problems } = await readWidgetFolder(folder)
    if (problems.length > 0) return { status: 'invalid', folder, problems }
    const read = readPackage(files)
    if (!read.ok) return { status: 'invalid', folder, problems: read.problems }
    return this.offer(read.widget, files, { kind: 'folder', path: folder }, folder)
  }

  /**
   * Holds a checked package for `install` once the user has seen what it may do, unless this app
   * can't take it. `location` is where it comes from, to show.
   */
  offer(widget: WidgetPackage, files: PackageTexts, origin: Origin, location: string): FolderCheck {
    const folder = location
    const { manifest, collector } = widget
    const refused: string[] = []
    if (reservedIds.includes(manifest.id)) {
      refused.push(`"${manifest.id}" is a widget built into ShiftPane. Give yours another id.`)
    }
    if (compareVersions(this.#options.appVersion, manifest.minAppVersion) < 0) {
      refused.push(
        `It needs ShiftPane ${manifest.minAppVersion} or later; this is ${this.#options.appVersion}.`,
      )
    }
    if (refused.length > 0) return { status: 'invalid', folder, problems: refused }

    const now = this.#now()
    for (const [token, pending] of this.#pending) {
      if (pending.expires < now) this.#pending.delete(token)
    }
    const token = randomUUID()
    this.#pending.set(token, { widget, texts: files, origin, expires: now + PENDING_MS })
    const before = this.#options.store.get(manifest.id)
    return {
      status: 'ready',
      from: origin.kind,
      token,
      folder,
      widget: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        hasCollector: collector !== undefined,
      },
      permissions: describePermissions(manifest.permissions),
      sendsOffPc: canSendOffPc(manifest.permissions),
      replaces: before
        ? {
            version: before.widget.manifest.version,
            added: addedPermissions(before.widget.manifest.permissions, manifest.permissions),
          }
        : null,
    }
  }

  /** Installs a folder `check` approved, once the user said yes to what it may do. */
  async install(token: string): Promise<InstallResult> {
    const pending = this.#pending.get(token)
    this.#pending.delete(token)
    if (!pending || pending.expires < this.#now()) {
      return { ok: false, problem: 'That check has expired. Try again.' }
    }
    try {
      const first = !this.#options.store.get(pending.widget.manifest.id)
      const entry = await this.#options.store.put(pending.widget, pending.texts, pending.origin)
      this.#runs.delete(entry.id)
      this.#changed()
      this.emit('added', { id: entry.id, origin: pending.origin, first })
      return { ok: true, id: entry.id }
    } catch (error) {
      return { ok: false, problem: `It couldn't be saved: ${(error as Error).message}` }
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.#options.store.get(id)) return
    await this.#options.store.remove(id)
    await this.#options.secrets.forget(id)
    this.#runs.delete(id)
    this.#changed()
  }

  /** Sets a widget's config; its collector runs again with it. Returns what was wrong, if anything. */
  async setConfig(id: string, values: Record<string, unknown>): Promise<string[]> {
    const problems = await this.#options.store.setConfig(id, values)
    if (problems.length === 0) {
      this.#runs.delete(id)
      this.#changed()
    }
    return problems
  }

  /** Sets or clears one of a widget's declared secrets. Returns why it couldn't, if it couldn't. */
  async setSecret(id: string, name: string, value: string | null): Promise<string | null> {
    const entry = this.#options.store.get(id)
    if (!entry?.widget.manifest.permissions.secrets.includes(name)) {
      return `That widget doesn't use ${name}.`
    }
    try {
      await this.#options.secrets.set(id, name, value)
    } catch (error) {
      return (error as Error).message
    }
    // Run again with it at the next chance.
    const run = this.#runs.get(id)
    if (run) run.lastRunAt = null
    this.emit('status')
    return null
  }

  /**
   * A button on an installed widget, pressed on a phone. Only an action the widget's manifest
   * declares is pressed, and a volume only with a value. Returns whether it was pressed.
   */
  async press(id: string, action: ActionName, value?: number): Promise<boolean> {
    const entry = this.#options.store.get(id)
    const press = this.#options.press
    if (!press || !entry?.widget.manifest.permissions.actions.includes(action)) return false
    if (action === 'audio.set-volume' && value === undefined) return false
    try {
      await press(action, value)
    } catch (error) {
      this.#log(`${id}: ${action} failed: ${(error as Error).message}`)
      return false
    }
    this.emit('pressed', id)
    return true
  }

  /** Where an installed widget came from: its folder, or the marketplace version. */
  origin(id: string): Origin | undefined {
    return this.#options.store.get(id)?.origin
  }

  /** Every installed widget's id, version and origin, for the marketplace to compare. */
  entries(): { id: string; version: string; origin: Origin }[] {
    return this.#options.store.list().map((entry) => ({
      id: entry.id,
      version: entry.widget.manifest.version,
      origin: entry.origin,
    }))
  }

  /** What the marketplace says about each installed widget: revoked versions, updates. */
  setStoreNotes(notes: Map<string, StoreNote>): void {
    this.#notes = notes
    this.emit('status')
  }
}
