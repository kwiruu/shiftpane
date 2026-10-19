import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { DeviceId, generateDeviceKey, type SavedPairing } from '@shiftpane/protocol'
import { z } from 'zod'
import type { RememberedPhone } from '../../shared/pairing.ts'
import type { TextStorage } from '../storage.ts'

/** Pairing one more phone than this forgets the one seen longest ago. */
export const MAX_REMEMBERED = 16

const Saved = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65_535).optional(),
  phones: z
    .array(
      z.object({
        deviceId: DeviceId,
        name: z.string().max(64),
        keyHash: z.string().regex(/^[0-9a-f]{64}$/),
        pairedAt: z.number(),
        lastSeenAt: z.number(),
      }),
    )
    .max(MAX_REMEMBERED),
})
type Stored = z.infer<typeof Saved>['phones'][number]

const hashKey = (key: string) => createHash('sha256').update(key).digest()

const remembered = ({ keyHash: _, ...phone }: Stored): RememberedPhone => phone

export interface PairedPhonesOptions {
  storage: TextStorage
  now?: () => number
  log?: (message: string) => void
}

/**
 * The phones this PC has paired, and the port they last reached it on, kept in the app's data
 * folder so a restart neither unpairs a phone nor moves the address an app on its home screen
 * opens. Each phone holds a random key; only the key's SHA-256 is kept here, so the file on its
 * own lets nobody in.
 */
export class PairedPhones extends EventEmitter<{ change: [RememberedPhone[]] }> {
  readonly #storage: TextStorage
  readonly #now: () => number
  readonly #log: (message: string) => void
  #phones: Stored[] = []
  #port: number | undefined
  #saving: Promise<void> = Promise.resolve()

  constructor(options: PairedPhonesOptions) {
    super()
    this.#storage = options.storage
    this.#now = options.now ?? Date.now
    this.#log = options.log ?? (() => {})
  }

  /** Reads what was saved. A missing or unreadable file starts with no phones. */
  async load(): Promise<void> {
    try {
      const text = await this.#storage.read()
      if (text === null) return
      const parsed = Saved.safeParse(JSON.parse(text))
      if (!parsed.success) {
        this.#log('the saved paired phones are unreadable; starting with none')
        return
      }
      this.#phones = parsed.data.phones
      this.#port = parsed.data.port
    } catch (error) {
      this.#log(`could not read the paired phones: ${describe(error)}`)
    }
  }

  /** Most recently seen first. */
  get list(): RememberedPhone[] {
    return this.#phones.toSorted((a, b) => b.lastSeenAt - a.lastSeenAt).map(remembered)
  }

  /** The port the server listened on last time, if it ever did. */
  get port(): number | undefined {
    return this.#port
  }

  set port(port: number) {
    if (port === this.#port) return
    this.#port = port
    this.#save()
  }

  /** Pairs a new phone and returns what it has to save. */
  add(name: string): SavedPairing {
    const now = this.#now()
    const pairing = { deviceId: randomUUID(), key: generateDeviceKey() }
    this.#phones.push({
      deviceId: pairing.deviceId,
      name,
      keyHash: hashKey(pairing.key).toString('hex'),
      pairedAt: now,
      lastSeenAt: now,
    })
    if (this.#phones.length > MAX_REMEMBERED) {
      const oldest = this.#phones.reduce((a, b) => (b.lastSeenAt < a.lastSeenAt ? b : a))
      this.#phones = this.#phones.filter((phone) => phone !== oldest)
    }
    this.#changed()
    return pairing
  }

  /**
   * The phone a saved pairing belongs to, or null when the key is wrong or the phone was
   * forgotten. A match counts as seeing the phone, under the name it gives now.
   */
  check(deviceId: string, key: string, name: string): RememberedPhone | null {
    const phone = this.#phones.find((item) => item.deviceId === deviceId)
    if (!phone || !timingSafeEqual(hashKey(key), Buffer.from(phone.keyHash, 'hex'))) return null
    phone.lastSeenAt = this.#now()
    phone.name = name
    this.#changed()
    return remembered(phone)
  }

  /** Drops a phone's key; it has to pair again. */
  forget(deviceId: string): boolean {
    const before = this.#phones.length
    this.#phones = this.#phones.filter((phone) => phone.deviceId !== deviceId)
    if (this.#phones.length === before) return false
    this.#changed()
    return true
  }

  /** Resolves once every change so far is on disk. */
  flush(): Promise<void> {
    return this.#saving
  }

  #changed(): void {
    this.#save()
    this.emit('change', this.list)
  }

  #save(): void {
    const text = JSON.stringify({ version: 1, port: this.#port, phones: this.#phones })
    this.#saving = this.#saving
      .then(() => this.#storage.write(text))
      .catch((error: unknown) => this.#log(`could not save the paired phones: ${describe(error)}`))
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))
