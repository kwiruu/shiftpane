import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256, verifySignature } from '@shiftpane/widget-runtime'
import {
  type IndexVersion,
  REGISTRY_URL,
  type RegistryIndex,
  type RevokedList,
  registryIndexSchema,
  registryPublicKeys,
  revokedListSchema,
} from '@shiftpane/widget-sdk'
import type { z } from 'zod'

/** Reads a URL's bytes, at most `limit` of them; throws on anything but a 200. */
export type Get = (url: string, limit: number) => Promise<Uint8Array>

const INDEX_LIMIT = 8 * 1024 * 1024
const SIGNATURE_LIMIT = 1024
const PACKAGE_LIMIT = 1024 * 1024
/** How long a fetched index is reused before asking again. */
const INDEX_TTL_MS = 5 * 60_000

/** Node's fetch, refusing anything but a 200 and anything over `limit`. */
export const httpGet: Get = async (url, limit) => {
  const answer = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow' })
  if (answer.status !== 200) throw new Error(`${new URL(url).host} answered ${answer.status}`)
  const length = Number(answer.headers.get('content-length') ?? 0)
  if (length > limit) throw new Error(`${url} is larger than it may be`)
  const bytes = new Uint8Array(await answer.arrayBuffer())
  if (bytes.byteLength > limit) throw new Error(`${url} is larger than it may be`)
  return bytes
}

export interface RegistryOptions {
  /** Where the cached index, revocations and packages are kept. */
  dir: string
  base?: string
  publicKeys?: readonly string[]
  get?: Get
  now?: () => number
  log?: (message: string) => void
}

/**
 * The marketplace's registry, read only after checking it is the marketplace's: the index and the
 * revocations must carry a signature from a key this app ships, and each package must have the
 * sha256 and size the signed index gives it. What was verified is kept on disk, so the app still
 * knows its widgets, and what was revoked, while offline.
 */
export class Registry {
  readonly #options: RegistryOptions
  readonly #log: (message: string) => void
  #index: { at: number; value: RegistryIndex } | null = null
  #revoked: RevokedList | null = null

  constructor(options: RegistryOptions) {
    this.#options = options
    this.#log = options.log ?? (() => {})
  }

  get #base(): string {
    return (this.#options.base ?? REGISTRY_URL).replace(/\/$/, '')
  }

  #now(): number {
    return (this.#options.now ?? Date.now)()
  }

  /** Every live widget and its approved versions. */
  async index(force = false): Promise<RegistryIndex> {
    if (!force && this.#index && this.#now() - this.#index.at < INDEX_TTL_MS) {
      return this.#index.value
    }
    const value = await this.#signed('index.json', registryIndexSchema, INDEX_LIMIT)
    this.#index = { at: this.#now(), value }
    return value
  }

  /** The index this app read last, without asking again. */
  get knownIndex(): RegistryIndex | null {
    return this.#index?.value ?? null
  }

  /** The versions the marketplace withdrew. */
  async revoked(): Promise<RevokedList> {
    this.#revoked = await this.#signed('revoked.json', revokedListSchema, INDEX_LIMIT)
    return this.#revoked
  }

  /** A version's package: from the cache when it is there and intact, else downloaded and checked. */
  async package(version: IndexVersion): Promise<Uint8Array> {
    const file = join(this.#options.dir, 'packages', `${version.sha256}.zip`)
    const cached = await readFile(file).catch(() => null)
    if (cached && sha256(cached) === version.sha256) return new Uint8Array(cached)
    const url = new URL(version.url)
    if (url.protocol !== 'https:' && !isLocal(url))
      throw new Error('A package has to come over https.')
    const bytes = await this.#get(url.href, PACKAGE_LIMIT)
    if (bytes.byteLength !== version.size || sha256(bytes) !== version.sha256) {
      throw new Error("The package isn't the one the marketplace signed for.")
    }
    await this.#keep(file, bytes)
    return bytes
  }

  #get(url: string, limit: number): Promise<Uint8Array> {
    return (this.#options.get ?? httpGet)(url, limit)
  }

  /**
   * A signed file: fetched with its signature, both kept once they check out. Offline, the kept
   * copy is checked again and used.
   */
  async #signed<T>(name: string, schema: z.ZodType<T>, limit: number): Promise<T> {
    const keys = this.#options.publicKeys ?? registryPublicKeys
    const file = join(this.#options.dir, name)
    let bytes: Uint8Array
    let signature: string
    let fresh = true
    try {
      ;[bytes, signature] = await Promise.all([
        this.#get(`${this.#base}/${name}`, limit),
        this.#get(`${this.#base}/${name}.sig`, SIGNATURE_LIMIT).then((sig) =>
          new TextDecoder().decode(sig),
        ),
      ])
    } catch (error) {
      const kept = await Promise.all([readFile(file), readFile(`${file}.sig`, 'utf8')]).catch(
        () => null,
      )
      if (!kept) throw new Error(`Can't reach the marketplace: ${(error as Error).message}`)
      this.#log(`using the ${name} kept from before: ${(error as Error).message}`)
      bytes = new Uint8Array(kept[0])
      signature = kept[1]
      fresh = false
    }
    if (!verifySignature(bytes, signature, keys)) {
      throw new Error(`The marketplace's ${name} isn't signed by ShiftPane, so it was not used.`)
    }
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (!parsed.success) throw new Error(`The marketplace's ${name} isn't one this app can read.`)
    if (fresh) {
      await this.#keep(file, bytes)
      await this.#keep(`${file}.sig`, new TextEncoder().encode(signature))
    }
    return parsed.data
  }

  async #keep(file: string, bytes: Uint8Array): Promise<void> {
    try {
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(`${file}.tmp`, bytes)
      await rename(`${file}.tmp`, file)
    } catch (error) {
      this.#log(`could not keep ${file}: ${(error as Error).message}`)
    }
  }
}

/** A registry on this PC, for trying the marketplace locally. */
function isLocal(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}
