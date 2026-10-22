import { z } from 'zod'
import type { TextStorage } from '../storage.ts'

/** Encrypts secrets at rest: Electron's `safeStorage` in the app, a stand-in in tests. */
export interface Cipher {
  /** False where the OS has no keychain to encrypt with (some Linux desktops). */
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

const Saved = z.object({
  version: z.literal(1),
  widgets: z.record(z.string(), z.record(z.string(), z.string())),
})

/**
 * Widgets' secrets, such as a GitHub token: kept encrypted on this PC, each readable only by
 * the widget it was entered for, and only the names that widget declares. They are handed to
 * its collector and never sent to a phone.
 */
export class WidgetSecrets {
  readonly #storage: TextStorage
  readonly #cipher: Cipher
  /** Encrypted, base64, by widget and name. */
  #saved: Record<string, Record<string, string>> = {}
  #saving: Promise<void> = Promise.resolve()

  constructor(storage: TextStorage, cipher: Cipher) {
    this.#storage = storage
    this.#cipher = cipher
  }

  async load(): Promise<void> {
    const json = await this.#storage.read().catch(() => null)
    if (json === null) return
    try {
      const parsed = Saved.safeParse(JSON.parse(json))
      if (parsed.success) this.#saved = parsed.data.widgets
    } catch {
      // A broken file is treated as no secrets; they can be entered again.
    }
  }

  get available(): boolean {
    return this.#cipher.available()
  }

  /** The names this widget has a value for. */
  names(widgetId: string): string[] {
    return Object.keys(Object.hasOwn(this.#saved, widgetId) ? (this.#saved[widgetId] ?? {}) : {})
  }

  /** The values of the declared names that are set, decrypted, for a collector run. */
  read(widgetId: string, declared: readonly string[]): Record<string, string> {
    const saved = Object.hasOwn(this.#saved, widgetId) ? this.#saved[widgetId] : undefined
    const values: Record<string, string> = {}
    if (!saved || !this.#cipher.available()) return values
    for (const name of declared) {
      const encrypted = Object.hasOwn(saved, name) ? saved[name] : undefined
      if (encrypted === undefined) continue
      try {
        values[name] = this.#cipher.decrypt(Buffer.from(encrypted, 'base64'))
      } catch {
        // Encrypted under another user or keychain: as if it had not been set.
      }
    }
    return values
  }

  /** Sets one secret, or clears it with null. */
  async set(widgetId: string, name: string, value: string | null): Promise<void> {
    const widget = { ...(Object.hasOwn(this.#saved, widgetId) ? this.#saved[widgetId] : {}) }
    if (value === null || value === '') delete widget[name]
    else {
      if (!this.#cipher.available()) throw new Error('This PC has no keychain to keep secrets in.')
      widget[name] = this.#cipher.encrypt(value).toString('base64')
    }
    this.#saved = { ...this.#saved, [widgetId]: widget }
    await this.#save()
  }

  /** Forgets every secret of a widget that was removed. */
  async forget(widgetId: string): Promise<void> {
    if (!Object.hasOwn(this.#saved, widgetId)) return
    const { [widgetId]: _, ...rest } = this.#saved
    this.#saved = rest
    await this.#save()
  }

  #save(): Promise<void> {
    const json = JSON.stringify({ version: 1, widgets: this.#saved })
    const saving = this.#saving.catch(() => {}).then(() => this.#storage.write(json))
    this.#saving = saving
    return saving
  }
}
