import {
  CloseCode,
  generateDeviceKey,
  generatePairingToken,
  type PairingCode,
  type PcMessage,
  type PhoneAuth,
  PROTOCOL_VERSION,
  parsePairingHash,
  type SavedPairing,
} from '@shiftpane/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  guessDeviceName,
  PcConnection,
  type PcConnectionOptions,
  type SocketLike,
  takePairingToken,
  websocketUrl,
} from './connection.ts'

const token = generatePairingToken()
const saved: SavedPairing = { deviceId: 'device-1', key: generateDeviceKey() }
const device = () => ({
  name: 'iPhone',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  touch: true,
})
const welcome: PcMessage = {
  type: 'welcome',
  protocol: PROTOCOL_VERSION,
  sessionId: 's1',
  pc: { name: 'desk', platform: 'windows' },
  features: { display: false, remoteControl: false },
}

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  sent: string[] = []
  closed = false
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  /** What the phone presented in its hello. */
  get auth(): PhoneAuth | undefined {
    const first = this.sent[0]
    return first ? (JSON.parse(first) as { auth: PhoneAuth }).auth : undefined
  }
  receive(message: PcMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

function setup(options: Partial<PcConnectionOptions> = {}) {
  const sockets: FakeSocket[] = []
  const connection = new PcConnection({
    url: 'wss://pc/ws',
    auth: [{ kind: 'token', token }],
    device,
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    backoffMs: () => 1000,
    ...options,
  })
  /** The latest socket, opened. */
  const open = () => {
    const socket = sockets.at(-1)
    socket?.onopen?.()
    return socket
  }
  return { connection, sockets, open }
}

describe('PcConnection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends hello on open and becomes connected on welcome', () => {
    const { connection, open } = setup()
    connection.start()
    const socket = open()
    expect(JSON.parse(socket?.sent[0] ?? '')).toMatchObject({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      auth: { kind: 'token', token },
    })
    socket?.receive(welcome)
    expect(connection.state).toMatchObject({
      status: 'connected',
      welcome: { pc: { name: 'desk' } },
    })
  })

  it('saves the key the PC pairs it with and presents only that from then on', () => {
    const onPaired = vi.fn()
    const { connection, sockets, open } = setup({ onPaired })
    connection.start()
    open()?.receive({ ...welcome, pairing: saved })
    expect(onPaired).toHaveBeenCalledWith(saved)
    sockets[0]?.onclose?.({ code: 1006 })
    vi.advanceTimersByTime(1000)
    expect(open()?.auth).toEqual({ kind: 'key', ...saved })
  })

  it('reconnects after a network drop', () => {
    const { connection, sockets } = setup()
    connection.start()
    sockets[0]?.onclose?.({ code: 1006 })
    expect(connection.state).toEqual({ status: 'connecting', attempt: 1 })
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
  })

  it.each([
    [CloseCode.disconnected, 'disconnected'],
    [CloseCode.protocolMismatch, 'protocol-mismatch'],
  ])('stops for good on close code %i', (code, reason) => {
    const { connection, sockets } = setup()
    connection.start()
    sockets[0]?.onclose?.({ code })
    expect(connection.state).toEqual({ status: 'rejected', reason })
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })

  it('reconnects with its key when asked after the PC disconnected it', () => {
    const { connection, sockets, open } = setup({ auth: [{ kind: 'key', ...saved }] })
    connection.start()
    open()?.receive(welcome)
    sockets[0]?.onclose?.({ code: CloseCode.disconnected })
    connection.reconnect()
    expect(sockets).toHaveLength(2)
    expect(open()?.auth).toEqual({ kind: 'key', ...saved })
  })

  it('asks for a code when it has nothing to present', () => {
    const { connection, sockets } = setup({ auth: [] })
    connection.start()
    expect(connection.state).toEqual({ status: 'unpaired', problem: null })
    expect(sockets).toHaveLength(0)
  })

  it('falls back from a forgotten key to the token just scanned, and drops the key', () => {
    const onForgotten = vi.fn()
    const { connection, sockets, open } = setup({
      auth: [
        { kind: 'key', ...saved },
        { kind: 'token', token },
      ],
      onForgotten,
    })
    connection.start()
    expect(open()?.auth?.kind).toBe('key')
    sockets[0]?.onclose?.({ code: CloseCode.unauthorized })
    expect(onForgotten).toHaveBeenCalledOnce()
    expect(open()?.auth).toEqual({ kind: 'token', token })
  })

  it.each([
    [{ kind: 'key', ...saved } as PhoneAuth, CloseCode.unauthorized, 'forgotten'],
    [{ kind: 'token', token } as PhoneAuth, CloseCode.unauthorized, 'old-link'],
  ])('asks for a code once %o is refused', (auth, code, problem) => {
    const { connection, sockets } = setup({ auth: [auth] })
    connection.start()
    sockets[0]?.onclose?.({ code })
    expect(connection.state).toEqual({ status: 'unpaired', problem })
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })

  it('pairs with a typed code, and says why one was refused', () => {
    const { connection, sockets, open } = setup({ auth: [] })
    connection.start()
    connection.pair('123456' as PairingCode)
    expect(connection.state).toEqual({ status: 'connecting', attempt: 0, checkingCode: true })
    expect(open()?.auth).toEqual({ kind: 'code', code: '123456' })
    sockets[0]?.onclose?.({ code: CloseCode.unauthorized })
    expect(connection.state).toEqual({ status: 'unpaired', problem: 'wrong-code' })

    connection.pair('654321' as PairingCode)
    sockets[1]?.onclose?.({ code: CloseCode.codeLocked })
    expect(connection.state).toEqual({ status: 'unpaired', problem: 'code-locked' })

    connection.pair('111111' as PairingCode)
    open()?.receive({ ...welcome, pairing: saved })
    expect(connection.state.status).toBe('connected')
  })

  it('reconnects at once when the page comes back instead of waiting out the backoff', () => {
    const { connection, sockets } = setup({ backoffMs: () => 10_000 })
    connection.start()
    sockets[0]?.onclose?.({ code: 1006 })
    connection.resume()
    expect(sockets).toHaveLength(2)
    // The timer it replaced does not open a third.
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(2)
  })

  it('replaces a connection that does not answer a ping after the page comes back', () => {
    const { connection, sockets, open } = setup({ probeMs: 2000 })
    connection.start()
    const first = open()
    first?.receive(welcome)
    connection.resume()
    expect(JSON.parse(first?.sent.at(-1) ?? '')).toMatchObject({ type: 'ping' })
    vi.advanceTimersByTime(2000)
    expect(first?.closed).toBe(true)
    expect(sockets).toHaveLength(2)
    expect(connection.state).toMatchObject({ status: 'connecting' })
  })

  it('keeps a connection that answers', () => {
    const { connection, sockets, open } = setup({ probeMs: 2000 })
    connection.start()
    const first = open()
    first?.receive(welcome)
    connection.resume()
    first?.receive({ type: 'pong', at: 1 })
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(1)
    expect(connection.state.status).toBe('connected')
  })

  it('ignores invalid frames from the PC', () => {
    const { connection, sockets } = setup()
    connection.start()
    sockets[0]?.onmessage?.({ data: '{"type":"welcome"}' })
    sockets[0]?.onmessage?.({ data: new ArrayBuffer(4) })
    expect(connection.state.status).toBe('connecting')
  })
})

describe('takePairingToken', () => {
  it('reads the token from the fragment and strips the URL', () => {
    const replaceState = vi.fn()
    const found = takePairingToken(
      parsePairingHash,
      { hash: `#t=${token}`, pathname: '/', search: '' },
      { replaceState },
    )
    expect(found).toBe(token)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('returns null and leaves the URL alone when there is no token', () => {
    const replaceState = vi.fn()
    expect(
      takePairingToken(parsePairingHash, { hash: '', pathname: '/', search: '' }, { replaceState }),
    ).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('builds the socket URL from the page origin', () => {
    expect(websocketUrl({ protocol: 'https:', host: '192.168.1.20:47820' })).toBe(
      'wss://192.168.1.20:47820/ws',
    )
    expect(websocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    )
  })

  it('guesses a device name', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone')
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari')).toBe(
      'Android phone',
    )
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 15; SM-X910) Safari')).toBe(
      'Android tablet',
    )
  })
})
