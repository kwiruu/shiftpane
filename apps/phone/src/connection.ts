import {
  CloseCode,
  encode,
  isRetryableClose,
  type PairingCode,
  type PairingToken,
  type PcMessage,
  type PhoneAuth,
  PROTOCOL_VERSION,
  parsePcMessage,
  type SavedPairing,
  WS_PATH,
} from '@shiftpane/protocol'

type Welcome = Extract<PcMessage, { type: 'welcome' }>

/** Why the phone is asking for a code. */
export type PairingProblem =
  /** The QR code was replaced, so the token in the link that opened this page is stale. */
  | 'old-link'
  | 'wrong-code'
  /** Too many wrong codes; the PC takes none until it shows a new one. */
  | 'code-locked'
  /** The PC no longer knows this phone's key: it was told to forget it. */
  | 'forgotten'

export type ConnectionState =
  /** Not paired with this PC: the user types the code the desktop app shows. */
  | { status: 'unpaired'; problem: PairingProblem | null }
  /** `checkingCode` while the PC looks at a code the user typed. */
  | { status: 'connecting'; attempt: number; checkingCode?: true }
  | { status: 'connected'; welcome: Welcome }
  /** Closed for good; the user has to reconnect (or update an app). */
  | {
      status: 'rejected'
      reason: 'disconnected' | 'protocol-mismatch' | 'bad-hello'
    }

export interface DeviceInfo {
  name: string
  viewport: { width: number; height: number }
  devicePixelRatio: number
  touch: boolean
}

/** The slice of the browser WebSocket this client uses, so tests can substitute a fake. */
export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number }) => void) | null
  send(data: string): void
  close(code?: number): void
}

export interface PcConnectionOptions {
  url: string
  /** What to present, best first; each one the PC refuses is dropped for the next. */
  auth: PhoneAuth[]
  device: () => DeviceInfo
  /** The PC paired this phone: save this, and present it next time. */
  onPaired?: (pairing: SavedPairing) => void
  /** The PC refused the saved key: it is no use any more. */
  onForgotten?: () => void
  createSocket?: (url: string) => SocketLike
  onMessage?: (message: PcMessage) => void
  /** Delay before reconnect attempt n (1-based). */
  backoffMs?: (attempt: number) => number
  /** How long a connection that looks up may stay silent after a ping before it counts as dead. */
  probeMs?: number
}

const REJECTED: Record<number, Extract<ConnectionState, { status: 'rejected' }>['reason']> = {
  [CloseCode.disconnected]: 'disconnected',
  [CloseCode.protocolMismatch]: 'protocol-mismatch',
  [CloseCode.badHello]: 'bad-hello',
}

function problemFor(auth: PhoneAuth, code: number): PairingProblem {
  switch (auth.kind) {
    case 'code':
      return code === CloseCode.codeLocked ? 'code-locked' : 'wrong-code'
    case 'token':
      return 'old-link'
    case 'key':
      return 'forgotten'
  }
}

/**
 * The phone's one connection to the PC. Sends `hello` as soon as the socket opens,
 * reconnects with backoff after network drops, and stops for good when the PC says the
 * user disconnected this phone.
 *
 * It presents a saved key, a token from the QR code or a code the user typed, and saves the
 * key the PC hands back when it pairs, so every later connection uses that key. When the PC
 * refuses all of them it waits for the user to type a code.
 */
export class PcConnection {
  #state: ConnectionState
  #socket: SocketLike | null = null
  #retry: ReturnType<typeof setTimeout> | undefined
  #probe: ReturnType<typeof setTimeout> | undefined
  #attempt = 0
  #stopped = false
  #auth: PhoneAuth[]
  readonly #listeners = new Set<() => void>()
  readonly #options: Required<
    Omit<PcConnectionOptions, 'onMessage' | 'onPaired' | 'onForgotten' | 'auth'>
  > &
    Pick<PcConnectionOptions, 'onMessage' | 'onPaired' | 'onForgotten'>

  constructor(options: PcConnectionOptions) {
    this.#options = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      backoffMs: (attempt) => Math.min(10_000, 500 * 2 ** (attempt - 1)),
      probeMs: 2_500,
      ...options,
    }
    this.#auth = [...options.auth]
    this.#state =
      this.#auth.length > 0
        ? { status: 'connecting', attempt: 0 }
        : { status: 'unpaired', problem: null }
  }

  get state(): ConnectionState {
    return this.#state
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getState = (): ConnectionState => this.#state

  start(): void {
    if (this.#auth.length === 0 || this.#socket) return
    this.#stopped = false
    this.#open()
  }

  stop(): void {
    this.#stopped = true
    this.#drop()
  }

  /** Pairs with a code the user typed, in place of whatever was tried before. */
  pair(code: PairingCode): void {
    this.#drop()
    this.#stopped = false
    this.#auth = [{ kind: 'code', code }]
    this.#attempt = 0
    this.#open()
  }

  /** Connects again after the PC disconnected this phone; it is still paired. */
  reconnect(): void {
    if (this.#state.status !== 'rejected' || this.#auth.length === 0) return
    this.#stopped = false
    this.#attempt = 0
    this.#open()
  }

  /**
   * The page is back in front (unlocked, switched back to, network back). A phone suspends a
   * page in the background, so a reconnect that was waiting goes now, and a connection that
   * looks up is pinged, and replaced when it does not answer.
   */
  resume(): void {
    if (this.#stopped) return
    if (this.#retry !== undefined && !this.#socket) {
      clearTimeout(this.#retry)
      this.#retry = undefined
      this.#open()
      return
    }
    if (this.#state.status !== 'connected' || !this.#socket || this.#probe !== undefined) return
    const socket = this.#socket
    socket.send(encode({ type: 'ping', at: Date.now() }))
    this.#probe = setTimeout(() => {
      this.#probe = undefined
      if (this.#socket !== socket) return
      this.#drop()
      this.#open()
    }, this.#options.probeMs)
  }

  send(message: Parameters<typeof encode>[0]): boolean {
    if (this.#state.status !== 'connected' || !this.#socket) return false
    this.#socket.send(encode(message))
    return true
  }

  #open(): void {
    const auth = this.#auth[0]
    if (!auth) return
    this.#set({
      status: 'connecting',
      attempt: this.#attempt,
      ...(auth.kind === 'code' && { checkingCode: true as const }),
    })
    const socket = this.#options.createSocket(this.#options.url)
    this.#socket = socket
    socket.onopen = () => {
      socket.send(
        encode({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          auth,
          device: this.#options.device(),
        }),
      )
    }
    socket.onmessage = (event) => {
      if (this.#socket !== socket) return
      // Anything at all from the PC shows the connection is alive.
      clearTimeout(this.#probe)
      this.#probe = undefined
      if (typeof event.data !== 'string') return
      const parsed = parsePcMessage(event.data)
      if (!parsed.ok) return
      if (parsed.message.type === 'welcome') {
        const { pairing } = parsed.message
        if (pairing) {
          this.#options.onPaired?.(pairing)
          // A token or code got the phone in once; its key does from now on.
          this.#auth = [{ kind: 'key', ...pairing }]
        } else {
          this.#auth = [auth]
        }
        this.#attempt = 0
        this.#set({ status: 'connected', welcome: parsed.message })
      }
      this.#options.onMessage?.(parsed.message)
    }
    socket.onclose = (event) => {
      if (this.#socket !== socket) return
      this.#socket = null
      clearTimeout(this.#probe)
      this.#probe = undefined
      if (this.#stopped) return
      if (event.code === CloseCode.unauthorized || event.code === CloseCode.codeLocked) {
        this.#refused(auth, event.code)
        return
      }
      const rejected = REJECTED[event.code]
      if (rejected || !isRetryableClose(event.code)) {
        this.#set({ status: 'rejected', reason: rejected ?? 'bad-hello' })
        return
      }
      this.#attempt += 1
      this.#set({ status: 'connecting', attempt: this.#attempt })
      this.#retry = setTimeout(() => {
        this.#retry = undefined
        this.#open()
      }, this.#options.backoffMs(this.#attempt))
    }
  }

  /** The PC turned `auth` down: try the next way in, or ask the user for a code. */
  #refused(auth: PhoneAuth, code: number): void {
    this.#auth = this.#auth.filter((item) => item !== auth)
    if (auth.kind === 'key') this.#options.onForgotten?.()
    if (this.#auth.length > 0) {
      this.#attempt = 0
      this.#open()
      return
    }
    this.#set({ status: 'unpaired', problem: problemFor(auth, code) })
  }

  /** Lets go of the socket and any pending reconnect or ping, without telling anyone. */
  #drop(): void {
    clearTimeout(this.#retry)
    clearTimeout(this.#probe)
    this.#retry = undefined
    this.#probe = undefined
    const socket = this.#socket
    this.#socket = null
    socket?.close(1000)
  }

  #set(state: ConnectionState): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}

/**
 * Takes the pairing token from the URL fragment and removes it from the address bar, so it
 * is not left in history or shown on screen. The token only matters until the PC answers with
 * this phone's key, which is what a reload presents.
 */
export function takePairingToken(
  parse: (hash: string) => PairingToken | null,
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState'> = window.history,
): PairingToken | null {
  const token = parse(location.hash)
  if (token) history.replaceState(null, '', `${location.pathname}${location.search}`)
  return token
}

export function websocketUrl(
  location: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`
}

/** A readable default name for the PC's phone list; the user cannot rename it yet. */
export function guessDeviceName(userAgent: string): string {
  if (/iPad/.test(userAgent)) return 'iPad'
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/Android/.test(userAgent))
    return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet'
  return 'Browser'
}
