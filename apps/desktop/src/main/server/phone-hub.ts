import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  CloseCode,
  encode,
  HELLO_TIMEOUT_MS,
  MAX_PHONES,
  type PcMessage,
  type PhoneMessage,
  PROTOCOL_VERSION,
  parsePhoneMessage,
  type ScreenReport,
  tokensEqual,
} from '@shiftpane/protocol'

/** The transport the hub needs; the server adapts a `ws` socket to this. */
export interface PhoneConnection {
  send(frame: string): void
  close(code: number, reason: string): void
  remoteAddress: string
}

export interface PhoneInfo {
  id: string
  name: string
  address: string
  viewport: { width: number; height: number }
  devicePixelRatio: number
  connectedAt: number
  /** How the phone's screen is laid out now (size, split, safe area); null until it says. */
  screen: ScreenReport | null
}

type Welcome = Extract<PcMessage, { type: 'welcome' }>

export interface PhoneHubOptions {
  /** Current pairing token. A getter, so rotating it revokes the old QR code. */
  token: () => string
  pc: Welcome['pc']
  features: () => Welcome['features']
  helloTimeoutMs?: number
  maxPhones?: number
  now?: () => number
}

export interface PhoneHubEvents {
  /** The list of paired phones changed. */
  change: [PhoneInfo[]]
  /** A validated message from a paired phone (everything except hello, ping and screen). */
  message: [PhoneInfo, PhoneMessage]
  /**
   * A phone's screen changed (rotation, split). Separate from `change` so the display and the
   * stream, which follow `change`, are not disturbed by it.
   */
  screen: [PhoneInfo]
}

interface Paired {
  info: PhoneInfo
  connection: PhoneConnection
}

/**
 * Owns every phone connection: enforces the pairing handshake, validates each frame,
 * answers pings and tells the rest of the app who is connected.
 *
 * A connection is anonymous until its first frame is a valid `hello` with the current
 * token; until then nothing else is processed and nothing is sent except the close.
 */
export class PhoneHub extends EventEmitter<PhoneHubEvents> {
  readonly #options: Required<Omit<PhoneHubOptions, 'pc' | 'token' | 'features'>> &
    Pick<PhoneHubOptions, 'pc' | 'token' | 'features'>
  readonly #paired = new Map<string, Paired>()

  constructor(options: PhoneHubOptions) {
    super()
    this.#options = {
      helloTimeoutMs: HELLO_TIMEOUT_MS,
      maxPhones: MAX_PHONES,
      now: Date.now,
      ...options,
    }
  }

  get phones(): PhoneInfo[] {
    return [...this.#paired.values()].map((p) => p.info)
  }

  /** Call for each new socket; wire the returned handlers to its message and close events. */
  accept(connection: PhoneConnection): { onMessage(frame: string): void; onClose(): void } {
    let phone: Paired | null = null
    let closed = false
    const close = (code: number, reason: string) => {
      if (closed) return
      closed = true
      clearTimeout(helloTimer)
      connection.close(code, reason)
    }
    const helloTimer = setTimeout(
      () => close(CloseCode.helloTimeout, 'hello timeout'),
      this.#options.helloTimeoutMs,
    )

    return {
      onMessage: (frame) => {
        if (closed) return
        if (!phone) {
          phone = this.#handshake(frame, connection, close)
          if (phone) clearTimeout(helloTimer)
          return
        }
        this.#handle(phone, frame)
      },
      onClose: () => {
        closed = true
        clearTimeout(helloTimer)
        if (phone && this.#paired.delete(phone.info.id)) this.#changed()
      },
    }
  }

  /** Closes one phone's connection (the Disconnect button). */
  disconnect(id: string): boolean {
    const phone = this.#paired.get(id)
    if (!phone) return false
    phone.connection.close(CloseCode.disconnected, 'disconnected from the PC')
    this.#paired.delete(id)
    this.#changed()
    return true
  }

  closeAll(code: number = CloseCode.shuttingDown, reason = 'PC is shutting down'): void {
    for (const { connection } of this.#paired.values()) connection.close(code, reason)
    this.#paired.clear()
    this.#changed()
  }

  send(id: string, message: PcMessage): boolean {
    const phone = this.#paired.get(id)
    phone?.connection.send(encode(message))
    return phone !== undefined
  }

  #handshake(
    frame: string,
    connection: PhoneConnection,
    close: (code: number, reason: string) => void,
  ) {
    // Check the version before the schema so an old phone gets "update" rather than "bad hello".
    const version = peekProtocol(frame)
    if (version !== undefined && version !== PROTOCOL_VERSION) {
      close(CloseCode.protocolMismatch, `PC speaks protocol ${PROTOCOL_VERSION}`)
      return null
    }
    const parsed = parsePhoneMessage(frame)
    if (!parsed.ok || parsed.message.type !== 'hello') {
      close(CloseCode.badHello, 'expected hello')
      return null
    }
    const hello = parsed.message
    if (!tokensEqual(hello.token, this.#options.token())) {
      close(CloseCode.unauthorized, 'pairing token rejected')
      return null
    }
    if (this.#paired.size >= this.#options.maxPhones) {
      close(CloseCode.tooManyPhones, 'too many phones connected')
      return null
    }
    const id = randomUUID()
    const phone: Paired = {
      connection,
      info: {
        id,
        name: hello.device.name,
        address: connection.remoteAddress,
        viewport: hello.device.viewport,
        devicePixelRatio: hello.device.devicePixelRatio,
        connectedAt: this.#options.now(),
        screen: null,
      },
    }
    this.#paired.set(id, phone)
    connection.send(
      encode({
        type: 'welcome',
        protocol: PROTOCOL_VERSION,
        sessionId: id,
        pc: this.#options.pc,
        features: this.#options.features(),
      }),
    )
    this.#changed()
    return phone
  }

  #handle(phone: Paired, frame: string): void {
    const parsed = parsePhoneMessage(frame)
    if (!parsed.ok) {
      phone.connection.send(
        encode({ type: 'error', code: 'bad-message', message: parsed.error.slice(0, 1024) }),
      )
      return
    }
    const message = parsed.message
    switch (message.type) {
      case 'hello':
        phone.connection.send(
          encode({ type: 'error', code: 'bad-message', message: 'already paired' }),
        )
        return
      case 'ping':
        phone.connection.send(encode({ type: 'pong', at: message.at }))
        return
      case 'screen': {
        const { type: _, ...screen } = message
        phone.info.screen = screen
        this.emit('screen', phone.info)
        return
      }
      default:
        this.emit('message', phone.info, message)
    }
  }

  #changed(): void {
    this.emit('change', this.phones)
  }
}

function peekProtocol(frame: string): unknown {
  try {
    const value: unknown = JSON.parse(frame)
    return typeof value === 'object' && value !== null && 'protocol' in value
      ? value.protocol
      : undefined
  } catch {
    return undefined
  }
}
