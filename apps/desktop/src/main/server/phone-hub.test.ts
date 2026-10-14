import { CloseCode, generatePairingToken, type PcMessage } from '@shiftpane/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type PhoneConnection, PhoneHub, type PhoneInfo } from './phone-hub.ts'

const token = generatePairingToken()

function fakeConnection() {
  const sent: PcMessage[] = []
  const closes: { code: number; reason: string }[] = []
  const connection: PhoneConnection = {
    remoteAddress: '192.168.1.42',
    send: (frame) => sent.push(JSON.parse(frame) as PcMessage),
    close: (code, reason) => closes.push({ code, reason }),
  }
  return { connection, sent, closes }
}

const hello = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'hello',
    protocol: 1,
    token,
    device: {
      name: 'Pixel 9',
      viewport: { width: 800, height: 360 },
      devicePixelRatio: 3,
      touch: true,
    },
    ...overrides,
  })

function makeHub(options: Partial<ConstructorParameters<typeof PhoneHub>[0]> = {}) {
  return new PhoneHub({
    token: () => token,
    pc: { name: 'desk', platform: 'windows' },
    features: () => ({ display: false, remoteControl: false }),
    now: () => 1000,
    ...options,
  })
}

function pair(hub: PhoneHub) {
  const conn = fakeConnection()
  const handlers = hub.accept(conn.connection)
  handlers.onMessage(hello())
  return { ...conn, handlers }
}

describe('PhoneHub handshake', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('welcomes a phone with the right token and reports it', () => {
    const hub = makeHub()
    const changes: PhoneInfo[][] = []
    hub.on('change', (phones) => changes.push(phones))
    const { sent, closes } = pair(hub)
    expect(closes).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'welcome', protocol: 1, pc: { platform: 'windows' } })
    expect(hub.phones).toEqual([
      expect.objectContaining({
        name: 'Pixel 9',
        address: '192.168.1.42',
        devicePixelRatio: 3,
        connectedAt: 1000,
      }),
    ])
    expect(changes).toHaveLength(1)
  })

  it.each([
    ['a wrong token', hello({ token: generatePairingToken() }), CloseCode.unauthorized],
    ['a newer protocol', hello({ protocol: 2 }), CloseCode.protocolMismatch],
    ['a non-hello first message', JSON.stringify({ type: 'ping', at: 1 }), CloseCode.badHello],
    ['garbage', 'not json', CloseCode.badHello],
  ])('closes on %s without sending anything', (_label, frame, code) => {
    const hub = makeHub()
    const { connection, sent, closes } = fakeConnection()
    hub.accept(connection).onMessage(frame)
    expect(closes).toEqual([expect.objectContaining({ code })])
    expect(sent).toEqual([])
    expect(hub.phones).toEqual([])
  })

  it('closes a silent connection after the hello timeout', () => {
    const hub = makeHub({ helloTimeoutMs: 5000 })
    const { connection, closes } = fakeConnection()
    hub.accept(connection)
    vi.advanceTimersByTime(4999)
    expect(closes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(closes).toEqual([expect.objectContaining({ code: CloseCode.helloTimeout })])
  })

  it('does not time out a paired phone', () => {
    const hub = makeHub({ helloTimeoutMs: 5000 })
    const { closes } = pair(hub)
    vi.advanceTimersByTime(60_000)
    expect(closes).toEqual([])
  })

  it('refuses phones beyond the limit', () => {
    const hub = makeHub({ maxPhones: 1 })
    pair(hub)
    expect(pair(hub).closes).toEqual([expect.objectContaining({ code: CloseCode.tooManyPhones })])
    expect(hub.phones).toHaveLength(1)
  })

  it('rejects the old token after it is rotated', () => {
    let current = token
    const hub = makeHub({ token: () => current })
    current = generatePairingToken()
    expect(pair(hub).closes).toEqual([expect.objectContaining({ code: CloseCode.unauthorized })])
  })
})

describe('PhoneHub after pairing', () => {
  it('answers pings, reports bad frames and forwards the rest', () => {
    const hub = makeHub()
    const received: string[] = []
    hub.on('message', (_phone, message) => received.push(message.type))
    const { sent, handlers, closes } = pair(hub)
    handlers.onMessage(JSON.stringify({ type: 'ping', at: 5 }))
    handlers.onMessage('{"type":"shell.exec"}')
    handlers.onMessage(hello())
    handlers.onMessage(
      JSON.stringify({
        type: 'stream.request',
        size: { width: 1440, height: 1080 },
        quality: 'auto',
      }),
    )
    expect(sent.map((m) => m.type)).toEqual(['welcome', 'pong', 'error', 'error'])
    expect(received).toEqual(['stream.request'])
    expect(closes).toEqual([])
  })

  it('removes a phone when its socket closes, and on Disconnect', () => {
    const hub = makeHub()
    const first = pair(hub)
    const second = pair(hub)
    first.handlers.onClose()
    expect(hub.phones).toHaveLength(1)
    const [remaining] = hub.phones
    expect(remaining && hub.disconnect(remaining.id)).toBe(true)
    expect(second.closes).toEqual([expect.objectContaining({ code: CloseCode.disconnected })])
    expect(hub.phones).toEqual([])
  })

  it('closes everyone on shutdown', () => {
    const hub = makeHub()
    const a = pair(hub)
    const b = pair(hub)
    hub.closeAll()
    expect([...a.closes, ...b.closes].map((c) => c.code)).toEqual([
      CloseCode.shuttingDown,
      CloseCode.shuttingDown,
    ])
    expect(hub.phones).toEqual([])
  })
})
