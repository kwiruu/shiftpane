import { EventEmitter } from 'node:events'
import { hostname } from 'node:os'
import { CloseCode, generatePairingToken, type PairingToken, pairingUrl } from '@shiftpane/protocol'
import QRCode from 'qrcode'
import type { LanHost, PairingState } from '../shared/pairing.ts'
import { loadOrCreateCertificate, type TlsCredentials } from './server/certificate.ts'
import { lanAddresses } from './server/lan.ts'
import { PhoneHub } from './server/phone-hub.ts'
import { type LanServer, startLanServer } from './server/server.ts'

export interface PairingServiceOptions {
  /** Where the TLS certificate is kept (the app's userData directory). */
  dataDir: string
  /** Built phone app to serve. */
  staticRoot: string
  platform: 'windows' | 'macos' | 'linux'
}

/**
 * Runs the LAN server and owns the pairing token. The token lives only in memory, so it
 * changes every time the app starts; "New code" rotates it and drops every phone.
 */
export class PairingService extends EventEmitter<{ change: [PairingState] }> {
  readonly hub: PhoneHub
  readonly #options: PairingServiceOptions
  #token: PairingToken = generatePairingToken()
  #state: PairingState = { status: 'starting' }
  #server: LanServer | null = null
  #tls: TlsCredentials | null = null
  #hosts: LanHost[] = []
  #host = ''

  constructor(options: PairingServiceOptions) {
    super()
    this.#options = options
    this.hub = new PhoneHub({
      token: () => this.#token,
      pc: { name: hostname().slice(0, 128), platform: options.platform },
      // Flipped on once the helper reports a ready virtual-display backend.
      features: () => ({ display: false, remoteControl: false }),
    })
    this.hub.on('change', () => void this.#publish())
  }

  get state(): PairingState {
    return this.#state
  }

  async start(): Promise<void> {
    try {
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
      })
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

  /** Revokes the current QR code: new token, every paired phone disconnected. */
  async newCode(): Promise<void> {
    this.#token = generatePairingToken()
    this.hub.closeAll(CloseCode.unauthorized, 'pairing code changed')
    await this.#publish()
  }

  async stop(): Promise<void> {
    this.hub.closeAll()
    await this.#server?.close()
    this.#server = null
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
      phones: this.hub.phones,
    })
  }

  #setState(state: PairingState): void {
    this.#state = state
    this.emit('change', state)
  }
}
