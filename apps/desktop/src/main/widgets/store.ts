import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ConfigField,
  configDefaults,
  readPackage,
  type WidgetPackage,
} from '@shiftpane/widget-sdk'
import { z } from 'zod'
import { fileStorage } from '../storage.ts'
import { PACKAGE_FILES, type PackageFile, type PackageTexts, readWidgetFolder } from './folder.ts'

/** A config value as the user set it. */
export type ConfigValues = Record<string, string | number | boolean>

/** Where an installed widget came from: a folder on this PC, loaded in Developer mode. */
export interface Origin {
  kind: 'folder'
  path: string
}

export interface InstalledRecord {
  id: string
  origin: Origin
  installedAt: number
  updatedAt: number
  config: ConfigValues
}

export interface InstalledEntry extends InstalledRecord {
  widget: WidgetPackage
  /** The package's files, as kept on disk. */
  texts: PackageTexts
}

const ConfigValue = z.union([z.string().max(512), z.number(), z.boolean()])

const Index = z.object({
  version: z.literal(1),
  widgets: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        origin: z.object({ kind: z.literal('folder'), path: z.string().max(4096) }),
        installedAt: z.number(),
        updatedAt: z.number(),
        config: z.record(z.string(), ConfigValue),
      }),
    )
    .max(256),
})

/**
 * Checks config values against a widget's fields: the right type, within a number's range, one
 * of a select's options. Values for fields the widget doesn't have are dropped; a field without a
 * value is left out (a required one is asked for before the collector runs).
 */
export function checkConfig(
  fields: ConfigField[],
  values: Record<string, unknown>,
): { config: ConfigValues; problems: string[] } {
  const config: ConfigValues = {}
  const problems: string[] = []
  for (const field of fields) {
    if (!Object.hasOwn(values, field.key)) continue
    const value = values[field.key]
    if (value === undefined || value === null || value === '') continue
    switch (field.type) {
      case 'string':
        if (typeof value === 'string' && value.length <= 512) config[field.key] = value.trim()
        else problems.push(`${field.label} has to be text.`)
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          problems.push(`${field.label} has to be a number.`)
        } else if (
          (field.min !== undefined && value < field.min) ||
          (field.max !== undefined && value > field.max)
        ) {
          problems.push(
            `${field.label} has to be between ${field.min ?? '-∞'} and ${field.max ?? '∞'}.`,
          )
        } else {
          config[field.key] = value
        }
        break
      case 'boolean':
        if (typeof value === 'boolean') config[field.key] = value
        else problems.push(`${field.label} has to be on or off.`)
        break
      case 'select':
        if (typeof value === 'string' && field.options.some((option) => option.value === value)) {
          config[field.key] = value
        } else {
          problems.push(`${field.label} has to be one of its options.`)
        }
        break
    }
  }
  return { config, problems }
}

/** A widget's config with its defaults filled in where the user set nothing. */
export function effectiveConfig(entry: Pick<InstalledEntry, 'widget' | 'config'>): ConfigValues {
  return { ...(configDefaults(entry.widget.manifest.config) as ConfigValues), ...entry.config }
}

/**
 * The widgets installed on this PC: each package's files in a folder of its own under `root`,
 * and `index.json` with where each came from and its config. A package is read and checked again
 * at every start; one that no longer passes is left out.
 */
export class InstalledStore {
  readonly #root: string
  readonly #index
  readonly #log: (message: string) => void
  readonly #entries = new Map<string, InstalledEntry>()
  #saving: Promise<void> = Promise.resolve()

  constructor(root: string, log: (message: string) => void = () => {}) {
    this.#root = root
    this.#index = fileStorage(join(root, 'index.json'))
    this.#log = log
  }

  /** Folders are named after the id with a prefix, so no id is a name Windows reserves (`con`). */
  #folder(id: string): string {
    return join(this.#root, `widget-${id}`)
  }

  async load(): Promise<InstalledEntry[]> {
    let records: InstalledRecord[] = []
    try {
      const json = await this.#index.read()
      if (json !== null) {
        const parsed = Index.safeParse(JSON.parse(json))
        if (parsed.success) records = parsed.data.widgets
        else this.#log('the installed widgets list is not valid; starting without it')
      }
    } catch (error) {
      this.#log(`could not read the installed widgets: ${(error as Error).message}`)
    }
    for (const record of records) {
      const { files, problems } = await readWidgetFolder(this.#folder(record.id))
      const read = problems.length === 0 ? readPackage(files) : { ok: false as const, problems }
      if (!read.ok || read.widget.manifest.id !== record.id) {
        this.#log(`left out ${record.id}: ${read.ok ? 'its id changed' : read.problems.join(' ')}`)
        continue
      }
      this.#entries.set(record.id, { ...record, widget: read.widget, texts: files })
    }
    return this.list()
  }

  list(): InstalledEntry[] {
    return [...this.#entries.values()].sort((a, b) => a.installedAt - b.installedAt)
  }

  get(id: string): InstalledEntry | undefined {
    return this.#entries.get(id)
  }

  /**
   * Installs a checked package, or replaces the installed copy of it. Config the user set is
   * kept where the new version still has the field.
   */
  async put(widget: WidgetPackage, texts: PackageTexts, origin: Origin): Promise<InstalledEntry> {
    const { id } = widget.manifest
    const incoming = join(this.#root, `.incoming-${randomUUID()}`)
    await mkdir(incoming, { recursive: true })
    try {
      for (const [key, name] of Object.entries(PACKAGE_FILES) as [PackageFile, string][]) {
        const text = texts[key]
        if (text !== undefined) await writeFile(join(incoming, name), text, 'utf8')
      }
      await rm(this.#folder(id), { recursive: true, force: true })
      await rename(incoming, this.#folder(id))
    } catch (error) {
      await rm(incoming, { recursive: true, force: true })
      throw error
    }
    const before = this.#entries.get(id)
    const now = Date.now()
    const entry: InstalledEntry = {
      id,
      origin,
      installedAt: before?.installedAt ?? now,
      updatedAt: now,
      config: checkConfig(widget.manifest.config, before?.config ?? {}).config,
      widget,
      texts,
    }
    this.#entries.set(id, entry)
    await this.#save()
    return entry
  }

  async remove(id: string): Promise<void> {
    if (!this.#entries.delete(id)) return
    await this.#save()
    await rm(this.#folder(id), { recursive: true, force: true })
  }

  /** Replaces a widget's config with checked values; says what was wrong instead when any was. */
  async setConfig(id: string, values: Record<string, unknown>): Promise<string[]> {
    const entry = this.#entries.get(id)
    if (!entry) return ['That widget is not installed.']
    const { config, problems } = checkConfig(entry.widget.manifest.config, values)
    if (problems.length > 0) return problems
    this.#entries.set(id, { ...entry, config })
    await this.#save()
    return []
  }

  #save(): Promise<void> {
    const json = JSON.stringify({
      version: 1,
      widgets: this.list().map(({ id, origin, installedAt, updatedAt, config }) => ({
        id,
        origin,
        installedAt,
        updatedAt,
        config,
      })),
    })
    // One write at a time, in order, so an older list never lands after a newer one.
    const saving = this.#saving
      .catch(() => {})
      .then(async () => {
        await mkdir(this.#root, { recursive: true })
        await this.#index.write(json)
      })
    this.#saving = saving
    return saving
  }
}
