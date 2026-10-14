import {
  CloseCode,
  encode,
  isRetryableClose,
  type PairingToken,
  type PcMessage,
  PROTOCOL_VERSION,
  parsePcMessage,
  WS_PATH,
} from '@shiftpane/protocol'

type Welcome = Extract<PcMessage, { type: 'welcome' }>

export type ConnectionState =
  | { status: 'no-token' }
  | { status: 'connecting'; attempt: number }
  | { status: 'connected'; welcome: Welcome }
  /** Closed for good; the user has to scan a new code (or update an app). */
  | {
      status: 'rejected'
      reason: 'unauthorized' | 'disconnected' | 'protocol-mismatch' | 'bad-hello'
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
  token: PairingToken | null
  device: () => DeviceInfo
  createSocket?: (url: string) => SocketLike
  onMessage?: (message: PcMessage) => void
  /** Delay before reconnect attempt n (1-based). */
  backoffMs?: (attempt: number) => number
}

const REJECTED: Record<number, Extract<ConnectionState, { status: 'rejected' }>['reason']> = {
  [CloseCode.unauthorized]: 'unauthorized',
  [CloseCode.disconnected]: 'disconnected',
  [CloseCode.protocolMismatch]: 'protocol-mismatch',
  [CloseCode.badHello]: 'bad-hello',
}

/**
 * The phone's one connection to the PC. Sends `hello` as soon as the socket opens,
 * reconnects with backoff after network drops, and stops for good when the PC says the
 * token is wrong or the user disconnected this phone.
 */
export class PcConnection {
  #state: ConnectionState
  #socket: SocketLike | null = null
  #retry: ReturnType<typeof setTimeout> | undefined
  #attempt = 0
  #stopped = false
  readonly #listeners = new Set<() => void>()
  readonly #options: Required<Omit<PcConnectionOptions, 'onMessage' | 'token'>> &
    Pick<PcConnectionOptions, 'onMessage' | 'token'>

  constructor(options: PcConnectionOptions) {
    this.#options = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      backoffMs: (attempt) => Math.min(10_000, 500 * 2 ** (attempt - 1)),
      ...options,
    }
    this.#state = options.token ? { status: 'connecting', attempt: 0 } : { status: 'no-token' }
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
    if (!this.#options.token || this.#socket) return
    this.#stopped = false
    this.#open()
  }

  stop(): void {
    this.#stopped = true
    clearTimeout(this.#retry)
    this.#socket?.close(1000)
    this.#socket = null
  }

  send(message: Parameters<typeof encode>[0]): boolean {
    if (this.#state.status !== 'connected' || !this.#socket) return false
    this.#socket.send(encode(message))
    return true
  }

  #open(): void {
    const token = this.#options.token
    if (!token) return
    this.#set({ status: 'connecting', attempt: this.#attempt })
    const socket = this.#options.createSocket(this.#options.url)
    this.#socket = socket
    socket.onopen = () => {
      socket.send(
        encode({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token,
          device: this.#options.device(),
        }),
      )
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const parsed = parsePcMessage(event.data)
      if (!parsed.ok) return
      if (parsed.message.type === 'welcome') {
        this.#attempt = 0
        this.#set({ status: 'connected', welcome: parsed.message })
      }
      this.#options.onMessage?.(parsed.message)
    }
    socket.onclose = (event) => {
      if (this.#socket !== socket) return
      this.#socket = null
      if (this.#stopped) return
      const rejected = REJECTED[event.code]
      if (rejected || !isRetryableClose(event.code)) {
        this.#set({ status: 'rejected', reason: rejected ?? 'bad-hello' })
        return
      }
      this.#attempt += 1
      this.#set({ status: 'connecting', attempt: this.#attempt })
      this.#retry = setTimeout(() => this.#open(), this.#options.backoffMs(this.#attempt))
    }
  }

  #set(state: ConnectionState): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}

const TOKEN_KEY = 'shiftpane.token'

/**
 * Takes the pairing token from the URL fragment and removes it from the address bar, so it
 * is not left in history or shown on screen. Falls back to this tab's stored token, so a
 * reload keeps working.
 */
export function takePairingToken(
  parse: (hash: string) => PairingToken | null,
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState'> = window.history,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(),
): PairingToken | null {
  const fromHash = parse(location.hash)
  if (fromHash) {
    try {
      storage?.setItem(TOKEN_KEY, fromHash)
    } catch {
      // Private mode: the token just won't survive a reload.
    }
    history.replaceState(null, '', `${location.pathname}${location.search}`)
    return fromHash
  }
  try {
    const stored = storage?.getItem(TOKEN_KEY)
    return stored ? parse(`#t=${stored}`) : null
  } catch {
    return null
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
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
