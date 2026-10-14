import {
  CloseCode,
  generatePairingToken,
  type PcMessage,
  parsePairingHash,
} from '@shiftpane/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  guessDeviceName,
  PcConnection,
  type SocketLike,
  takePairingToken,
  websocketUrl,
} from './connection.ts'

const token = generatePairingToken()
const device = () => ({
  name: 'iPhone',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  touch: true,
})
const welcome: PcMessage = {
  type: 'welcome',
  protocol: 1,
  sessionId: 's1',
  pc: { name: 'desk', platform: 'windows' },
  features: { display: false, remoteControl: false },
}

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  sent: string[] = []
  send(data: string) {
    this.sent.push(data)
  }
  close() {}
}

function setup() {
  const sockets: FakeSocket[] = []
  const connection = new PcConnection({
    url: 'wss://pc/ws',
    token,
    device,
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    backoffMs: () => 1000,
  })
  return { connection, sockets }
}

describe('PcConnection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends hello on open and becomes connected on welcome', () => {
    const { connection, sockets } = setup()
    connection.start()
    const socket = sockets[0]
    socket?.onopen?.()
    expect(JSON.parse(socket?.sent[0] ?? '')).toMatchObject({ type: 'hello', protocol: 1, token })
    socket?.onmessage?.({ data: JSON.stringify(welcome) })
    expect(connection.state).toMatchObject({
      status: 'connected',
      welcome: { pc: { name: 'desk' } },
    })
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
    [CloseCode.unauthorized, 'unauthorized'],
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

  it('does nothing without a token', () => {
    const connection = new PcConnection({ url: 'wss://pc/ws', token: null, device })
    connection.start()
    expect(connection.state).toEqual({ status: 'no-token' })
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
  const memory = () => {
    const data = new Map<string, string>()
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
  }

  it('reads the token from the fragment, stores it and strips the URL', () => {
    const storage = memory()
    const replaceState = vi.fn()
    const found = takePairingToken(
      parsePairingHash,
      { hash: `#t=${token}`, pathname: '/', search: '' },
      { replaceState },
      storage,
    )
    expect(found).toBe(token)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    // A reload has no fragment but the same tab still has the token.
    expect(
      takePairingToken(
        parsePairingHash,
        { hash: '', pathname: '/', search: '' },
        { replaceState },
        storage,
      ),
    ).toBe(token)
  })

  it('returns null when there is no token anywhere', () => {
    expect(
      takePairingToken(
        parsePairingHash,
        { hash: '', pathname: '/', search: '' },
        { replaceState: vi.fn() },
        memory(),
      ),
    ).toBeNull()
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
