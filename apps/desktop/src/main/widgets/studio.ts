import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WidgetId } from '@shiftpane/protocol'
import { reservedIds } from '@shiftpane/widget-sdk'
import { z } from 'zod'
import { buildFiles, idFromName, recipeSchema } from '../../shared/studio.ts'
import type { FolderCheck, StudioWidget } from '../../shared/widgets.ts'
import type { TextStorage } from '../storage.ts'
import type { InstalledWidgets } from './installed.ts'

/** A GitHub login, which is what a manifest's author is; anything else is saved as "me". */
const Login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)

const Saved = z.record(WidgetId, z.object({ recipe: recipeSchema, author: z.string().max(64) }))
type Saved = z.infer<typeof Saved>

export interface StudioOptions {
  installed: InstalledWidgets
  /** Where Studio writes the widgets it makes, a folder each (Documents\ShiftPane widgets). */
  folder: string
  /** Each widget's recipe, to edit it again. */
  storage: TextStorage
  appVersion: string
  now?: () => Date
}

/**
 * Widget Studio from the main process: a recipe from the window becomes a widget folder, which is
 * then checked and offered like any folder, so installing it shows the same permission prompt.
 * Paths never come from the window; Studio picks the folder from the widget's id.
 */
export class Studio {
  readonly #options: StudioOptions
  #saved: Promise<Saved> | null = null

  constructor(options: StudioOptions) {
    this.#options = options
  }

  /** The widget Studio made with this id, to open again. */
  async get(id: string): Promise<StudioWidget | null> {
    const entry = (await this.#read())[id]
    return entry ? { id, ...entry } : null
  }

  /** The ids of the widgets Studio made. */
  async ids(): Promise<string[]> {
    return Object.keys(await this.#read())
  }

  /**
   * Writes the widget a recipe makes and checks it for the install prompt. With `id`, it saves
   * over that Studio widget, a version up from the one installed; otherwise it gets a new id.
   */
  async save(input: unknown, id: string | null, author: unknown): Promise<FolderCheck> {
    const parsed = recipeSchema.safeParse(input)
    if (!parsed.success) {
      return { status: 'invalid', folder: '', problems: ['This widget is missing something.'] }
    }
    const recipe = parsed.data
    const saved = await this.#read()
    const target =
      id && WidgetId.safeParse(id).success && saved[id] ? id : await this.#newId(recipe.name, saved)
    const login = Login.safeParse(author)
    const installed = this.#options.installed.list().find((widget) => widget.id === target)
    const folder = join(this.#options.folder, target)
    const files = buildFiles(recipe, {
      id: target,
      version: installed ? nextPatch(installed.version) : '0.1.0',
      author: login.success ? login.data : 'me',
      appVersion: this.#options.appVersion,
      year: (this.#options.now?.() ?? new Date()).getFullYear(),
    })
    await mkdir(folder, { recursive: true })
    for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), text)
    saved[target] = { recipe, author: login.success ? login.data : 'me' }
    await this.#options.storage.write(JSON.stringify(saved))
    return this.#options.installed.check(folder)
  }

  /** An id from the name that no other widget, built-in or installed or Studio's, has. */
  async #newId(name: string, saved: Saved): Promise<string> {
    let base = idFromName(name)
    if (reservedIds.includes(base)) base = `${base}-widget`
    const taken = new Set([
      ...Object.keys(saved),
      ...this.#options.installed.list().map((widget) => widget.id),
    ])
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base.slice(0, 60)}-${n}`
      if (taken.has(id)) continue
      // A folder someone made by hand is theirs; leave it alone.
      if (await exists(join(this.#options.folder, id))) continue
      return id
    }
  }

  #read(): Promise<Saved> {
    this.#saved ??= this.#options.storage
      .read()
      .then((json) => (json === null ? {} : Saved.parse(JSON.parse(json))))
      .catch(() => ({}))
    return this.#saved
  }
}

/** 1.2.3 becomes 1.2.4; a pre-release becomes its release. */
function nextPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.*)?$/.exec(version)
  if (!match) return '0.1.0'
  const [, major, minor, patch, pre] = match
  return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${Number(patch) + 1}`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
