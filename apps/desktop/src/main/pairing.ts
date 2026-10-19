import { EventEmitter } from 'node:events'
import { hostname } from 'node:os'
import { join } from 'node:path'
import {
  CloseCode,
  generatePairingCode,
  generatePairingToken,
  type PairingCode,
  type PairingToken,
  type PhoneAuth,
  pairingUrl,
  tokensEqual,
} from '@shiftpane/protocol'
import QRCode from 'qrcode'
import type { LanHost, PairingState } from '../shared/pairing.ts'
import { loadOrCreateCertificate, type TlsCredentials } from './server/certificate.ts'
import { lanAddresses } from './server/lan.ts'
import { PairedPhones } from './server/paired-phones.ts'
import { type Admission, PhoneHub } from './server/phone-hub.ts'
import { type LanServer, startLanServer } from './server/server.ts'
import { fileStorage, type TextStorage } from './storage.ts'

/** How long a pairing code lasts before the desktop app shows the next one. */
export const CODE_LIFETIME_MS = 10 * 60_000

/** Wrong codes the PC takes before it refuses every code until the next one. */
export const MAX_CODE_TRIES = 5

export interface PairingServiceOptions {
  /** Where the TLS certificate and the paired phones are kept (the app's userData directory). */
  dataDir: string
  /** Built phone app to serve. */
  staticRoot: string
  platform: 'windows' | 'macos' | 'linux'
  /** Whether a virtual monitor can be created; told to each phone in `welcome`. */
  displayAvailable?: () => boolean
  /** Where the paired phones are kept; a file in `dataDir` unless a test passes its own. */
  storage?: TextStorage
  /** Tests pass their own, to know what to present. */
  makeToken?: () => PairingToken
  makeCode?: () => PairingCode
  now?: () => number
  log?: (message: string) => void
}

interface Code {
  digits: PairingCode
  expiresAt: number
  wrongTries: number
}

const refuse = (code: number, reason: string): Admission => ({ ok: false, code, reason })

/**
 * Runs the LAN server and decides which phones may connect.
 *
 * A phone pairs with the token in the QR code or with the six-digit code shown under it, and
 * gets a key that lets it back in from then on (`PairedPhones`). The token and the code live
 * only in memory: the token changes every time the app starts, the code every ten minutes and
 * after each use, and "New code" replaces both. Phones already paired stay paired until the
 * user forgets them.
 */
export class PairingService extends EventEmitter<{ change: [PairingState] }> {
  readonly hub: PhoneHub
  readonly #options: PairingServiceOptions
  readonly #now: () => number
  readonly #phones: PairedPhones
  readonly #makeToken: () => PairingToken
  readonly #makeDigits: () => PairingCode
  #token: PairingToken
  #code: Code
  #codeTimer: ReturnType<typeof setTimeout> | undefined
  #state: PairingState = { status: 'starting' }
  #server: LanServer | null = null
  #tls: TlsCredentials | null = null
  #hosts: LanHost[] = []
  #host = ''

  constructor(options: PairingServiceOptions) {
    super()
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#makeToken = options.makeToken ?? generatePairingToken
    this.#makeDigits = options.makeCode ?? generatePairingCode
    this.#token = this.#makeToken()
    this.#code = this.#makeCode()
    this.#phones = new PairedPhones({
      storage: options.storage ?? fileStorage(join(options.dataDir, 'pairing.json')),
      now: this.#now,
      log: options.log,
    })
    this.hub = new PhoneHub({
      admit: (auth, device) => this.#admit(auth, device.name),
      pc: { name: hostname().slice(0, 128), platform: options.platform },
      // On once the helper reports a ready virtual-display backend.
      features: () => ({ display: options.displayAvailable?.() ?? false, remoteControl: false }),
    })
    this.hub.on('change', () => void this.#publish())
    // The window's layout editor previews each phone's screen as it is now.
    this.hub.on('screen', () => void this.#publish())
    this.#phones.on('change', () => void this.#publish())
  }

  get state(): PairingState {
    return this.#state
  }

  async start(): Promise<void> {
    try {
      await this.#phones.load()
      this.#hosts = lanAddresses()
      if (this.#hosts.length === 0) {
        this.#setState({
          status: 'error',
          message: 'This PC has no network address. Connect to Wi-Fi or Ethernet.',
        })
        return
      }
      this.#host = this.#hosts[0]?.address ?? ''
      this.#tls = await loadOrCreateCertificate(
        this.#options.dataDir,
        this.#hosts.map((h) => h.address),
      )
      this.#server = await startLanServer({
        tls: this.#tls,
        staticRoot: this.#options.staticRoot,
        hub: this.hub,
        // Where phones found this PC last time; an app on a home screen knows no other.
        port: this.#phones.port,
      })
      this.#phones.port = this.#server.port
      this.#replaceCode()
      await this.#publish()
    } catch (error) {
      this.#setState({
        status: 'error',
        message: `Could not start the local server: ${String(error)}`,
      })
    }
  }

  /** Picks which of the PC's addresses goes in the QR code. */
  async selectHost(address: string): Promise<void> {
    if (!this.#hosts.some((h) => h.address === address)) return
    this.#host = address
    await this.#publish()
  }

  /** Replaces the QR code and the pairing code. Phones already paired stay connected. */
  async newCode(): Promise<void> {
    this.#token = this.#makeToken()
    this.#replaceCode()
    await this.#publish()
  }

  /** Drops a phone's key and closes its connection; it has to pair again. */
  forget(deviceId: string): void {
    this.#phones.forget(deviceId)
    for (const phone of this.hub.phones) {
      if (phone.deviceId === deviceId) {
        this.hub.disconnect(phone.id, CloseCode.unauthorized, 'this phone was forgotten')
      }
    }
  }

  async stop(): Promise<void> {
    clearTimeout(this.#codeTimer)
    this.hub.closeAll()
    await this.#server?.close()
    this.#server = null
    await this.#phones.flush()
  }

  #admit(auth: PhoneAuth, name: string): Admission {
    switch (auth.kind) {
      case 'key': {
        const phone = this.#phones.check(auth.deviceId, auth.key, name)
        return phone
          ? { ok: true, deviceId: phone.deviceId }
          : refuse(CloseCode.unauthorized, 'this phone is not paired')
      }
      case 'token':
        return tokensEqual(auth.token, this.#token)
          ? this.#pair(name)
          : refuse(CloseCode.unauthorized, 'pairing token rejected')
      case 'code': {
        const code = this.#code
        if (code.wrongTries >= MAX_CODE_TRIES) {
          return refuse(CloseCode.codeLocked, 'too many wrong codes')
        }
        if (this.#now() >= code.expiresAt || !tokensEqual(auth.code, code.digits)) {
          code.wrongTries += 1
          // The window says so, and that a new code is needed.
          if (code.wrongTries === MAX_CODE_TRIES) void this.#publish()
          return refuse(CloseCode.unauthorized, 'pairing code rejected')
        }
        // One phone per code: the next phone types the next one.
        this.#replaceCode()
        return this.#pair(name)
      }
    }
  }

  #pair(name: string): Admission {
    const pairing = this.#phones.add(name)
    return { ok: true, deviceId: pairing.deviceId, pairing }
  }

  #makeCode(): Code {
    return {
      digits: this.#makeDigits(),
      expiresAt: this.#now() + CODE_LIFETIME_MS,
      wrongTries: 0,
    }
  }

  /** A fresh code, and a timer for the one after it. */
  #replaceCode(): void {
    clearTimeout(this.#codeTimer)
    this.#code = this.#makeCode()
    this.#codeTimer = setTimeout(() => {
      this.#replaceCode()
      void this.#publish()
    }, CODE_LIFETIME_MS)
  }

  async #publish(): Promise<void> {
    if (!this.#server || !this.#tls) return
    const url = pairingUrl({ host: this.#host, port: this.#server.port, token: this.#token })
    const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
    this.#setState({
      status: 'ready',
      url,
      qrSvg,
      host: this.#host,
      hosts: this.#hosts,
      port: this.#server.port,
      fingerprint: this.#tls.fingerprint,
      code: {
        digits: this.#code.digits,
        expiresAt: this.#code.expiresAt,
        locked: this.#code.wrongTries >= MAX_CODE_TRIES,
      },
      phones: this.hub.phones,
      remembered: this.#phones.list,
    })
  }

  #setState(state: PairingState): void {
    this.#state = state
    this.emit('change', state)
  }
}
