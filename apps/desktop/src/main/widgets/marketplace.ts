import { openPackage, type PackageTexts, packageTexts } from '@shiftpane/widget-runtime'
import {
  API_URL,
  compareVersions,
  type IndexEntry,
  type IndexVersion,
  MARKETPLACE_URL,
  type Permissions,
  type RevokedList,
  readPackage,
  type WidgetPackage,
} from '@shiftpane/widget-sdk'
import type { FolderCheck } from '../../shared/widgets.ts'
import type { InstalledWidgets, StoreNote } from './installed.ts'
import type { Registry } from './registry.ts'

/**
 * Tells the marketplace a widget from it was installed on one more PC, for the count on its page.
 * Only the widget's id goes; a failure is ignored, since the count is a courtesy.
 */
export async function reportInstall(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(`${API_URL}/widgets/${encodeURIComponent(id)}/installed`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}

/** How often the revocations and the index are read again while the app runs. */
export const REFRESH_MS = 6 * 60 * 60_000

export interface MarketplaceOptions {
  registry: Registry
  installed: InstalledWidgets
  appVersion: string
  log?: (message: string) => void
}

const key = (id: string, version: string) => `${id}@${version}`

/** Two permission sets list the same things, in any order. */
function samePermissions(a: Permissions, b: Permissions): boolean {
  const flat = (p: Permissions) =>
    (Object.keys(p) as (keyof Permissions)[])
      .sort()
      .map((kind) => `${kind}:${[...p[kind]].sort().join(',')}`)
      .join(';')
  return flat(a) === flat(b)
}

/**
 * The marketplace from the desktop app. Browsing happens on the website; here, an install link
 * gets a widget's version from the signed index and installs it after the same permission prompt
 * as a folder, and the installed ones are kept honest: a revoked version stops running at once, a
 * newer one is offered.
 */
export class Marketplace {
  readonly #options: MarketplaceOptions
  readonly #log: (message: string) => void
  #revoked = new Map<string, string>()
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(options: MarketplaceOptions) {
    this.#options = options
    this.#log = options.log ?? (() => {})
  }

  /** Reads the revocations and the index now, then every six hours. */
  start(): void {
    void this.refresh()
    this.#timer ??= setInterval(() => void this.refresh(), REFRESH_MS)
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  /**
   * Reads the revocations, then the index, and tells the installed widgets what they say. The
   * revocations come first: a withdrawn version stops even when the index can't be read.
   */
  async refresh(): Promise<void> {
    try {
      this.#applyRevoked(await this.#options.registry.revoked())
    } catch (error) {
      this.#log(`revocations: ${(error as Error).message}`)
    }
    try {
      await this.#options.registry.index(true)
    } catch (error) {
      this.#log(`index: ${(error as Error).message}`)
    }
    this.#notes()
  }

  #applyRevoked(list: RevokedList): void {
    this.#revoked = new Map(list.versions.map((v) => [key(v.id, v.version), v.reason]))
  }

  /** The newest version this app can run that hasn't been withdrawn. */
  #pick(entry: IndexEntry): [string, IndexVersion] | null {
    const versions = Object.entries(entry.versions).sort(([a], [b]) => compareVersions(b, a))
    for (const [version, details] of versions) {
      if (this.#revoked.has(key(entry.id, version))) continue
      if (compareVersions(this.#options.appVersion, details.minAppVersion) < 0) continue
      return [version, details]
    }
    return null
  }

  #notes(): void {
    const index = this.#options.registry.knownIndex
    const notes = new Map<string, StoreNote>()
    for (const { id, version, origin } of this.#options.installed.entries()) {
      if (origin.kind !== 'marketplace') continue
      const note: StoreNote = {}
      const reason = this.#revoked.get(key(id, version))
      if (reason !== undefined) note.revoked = reason
      const entry = index?.widgets.find((widget) => widget.id === id)
      const newest = entry && this.#pick(entry)
      if (newest && compareVersions(newest[0], version) > 0) note.update = newest[0]
      if (note.revoked !== undefined || note.update !== undefined) notes.set(id, note)
    }
    this.#options.installed.setStoreNotes(notes)
  }

  /** A version's package, verified, opened and read. */
  async #read(
    id: string,
    version: string,
    details: IndexVersion,
  ): Promise<{ widget: WidgetPackage; texts: PackageTexts }> {
    const opened = openPackage(await this.#options.registry.package(details))
    const { texts, problems } = packageTexts(opened)
    if (opened.problems.length > 0 || problems.length > 0) {
      throw new Error([...opened.problems, ...problems].join(' '))
    }
    const read = readPackage(texts)
    if (!read.ok) throw new Error(read.problems.join(' '))
    const { manifest } = read.widget
    // The signed index and the package have to agree on what this is and what it may do.
    if (manifest.id !== id || manifest.version !== version) {
      throw new Error("The package isn't the version the marketplace lists.")
    }
    if (!samePermissions(manifest.permissions, details.permissions)) {
      throw new Error('The package asks for other permissions than the marketplace lists.')
    }
    return { widget: read.widget, texts }
  }

  /**
   * Gets the version of a widget this app should install, checks it like a folder, and holds it
   * for the permission prompt.
   */
  async check(id: string): Promise<FolderCheck> {
    const location = `${MARKETPLACE_URL}/widgets/${id}`
    try {
      const index = await this.#options.registry.index()
      const entry = index.widgets.find((widget) => widget.id === id)
      if (!entry) {
        return {
          status: 'invalid',
          folder: location,
          problems: ["The marketplace doesn't have it."],
        }
      }
      const picked = this.#pick(entry)
      if (!picked) {
        const latest = entry.versions[entry.latest]
        return {
          status: 'invalid',
          folder: location,
          problems: [
            latest && compareVersions(this.#options.appVersion, latest.minAppVersion) < 0
              ? `It needs ShiftPane ${latest.minAppVersion} or later; this is ${this.#options.appVersion}.`
              : 'Every version of it was withdrawn.',
          ],
        }
      }
      const [version, details] = picked
      const { widget, texts } = await this.#read(id, version, details)
      return this.#options.installed.offer(
        widget,
        texts,
        { kind: 'marketplace', version, sha256: details.sha256 },
        location,
      )
    } catch (error) {
      return { status: 'invalid', folder: location, problems: [(error as Error).message] }
    }
  }
}
