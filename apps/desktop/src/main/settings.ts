import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/widgets.ts'
import type { TextStorage } from './storage.ts'

const Saved = z.object({
  developerMode: z.boolean().default(false),
  generatorModel: z
    .string()
    .regex(/^[\w.:/-]{1,128}$/)
    .nullable()
    .default(null),
  monitorScale: z
    .union([z.literal('phone'), z.literal('os'), z.number().int().min(100).max(500)])
    .default('phone'),
})

/** App-wide settings from the desktop window, kept between runs. */
export class SettingsService extends EventEmitter<{ change: [AppSettings] }> {
  readonly #storage: TextStorage
  #settings: AppSettings = DEFAULT_SETTINGS
  readonly #loaded: Promise<void>

  constructor(storage: TextStorage) {
    super()
    this.#storage = storage
    this.#loaded = storage
      .read()
      .then((json) => {
        if (json === null) return
        const parsed = Saved.safeParse(JSON.parse(json))
        if (parsed.success) this.#settings = parsed.data
      })
      .catch(() => {})
  }

  async get(): Promise<AppSettings> {
    await this.#loaded
    return this.#settings
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.#loaded
    const parsed = Saved.partial().safeParse(patch)
    if (!parsed.success) return this.#settings
    // zod fills in the defaults of keys the patch left out; only the ones it names change.
    const named = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) => Object.hasOwn(patch, key)),
    )
    this.#settings = { ...this.#settings, ...named }
    await this.#storage.write(JSON.stringify(this.#settings))
    this.emit('change', this.#settings)
    return this.#settings
  }
}
