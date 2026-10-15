import { EventEmitter } from 'node:events'
import { generatePairingToken, type PcMessage } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { type PhoneConnection, PhoneHub } from '../server/phone-hub.ts'
import { bindDisplayToHub, type DisplayBinding } from './hub.ts'

const token = generatePairingToken()

function fakeConnection() {
  const sent: PcMessage[] = []
  const connection: PhoneConnection = {
    remoteAddress: '192.168.1.42',
    send: (frame) => sent.push(JSON.parse(frame) as PcMessage),
    close: () => {},
  }
  return { connection, sent }
}

function pair(hub: PhoneHub, viewport = { width: 800, height: 360 }) {
  const { connection, sent } = fakeConnection()
  const handlers = hub.accept(connection)
  handlers.onMessage(
    JSON.stringify({
      type: 'hello',
      protocol: 1,
      token,
      device: { name: 'Pixel 9', viewport, devicePixelRatio: 3, touch: true },
    }),
  )
  return { handlers, sent }
}

/** Records what the hub tells the display controller, and lets tests fire its events. */
function fakeDisplay() {
  const log: unknown[][] = []
  const emitter = new EventEmitter()
  const display = {
    phoneJoined: (phone: unknown) => log.push(['joined', phone]),
    phoneLeft: (id: string) => log.push(['left', id]),
    streamRequested: (id: string, size: unknown, screen: unknown) =>
      log.push(['request', id, size, screen]),
    streamStopped: (id: string) => log.push(['stop', id]),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  } as unknown as DisplayBinding
  return { display, log, emitter }
}

function makeHub() {
  return new PhoneHub({
    token: () => token,
    pc: { name: 'desk', platform: 'windows' },
    features: () => ({ display: true, remoteControl: false }),
  })
}

describe('bindDisplayToHub', () => {
  it('tells the controller about a phone with the viewport it paired with', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    bindDisplayToHub(display, hub)
    pair(hub)
    expect(log).toEqual([
      [
        'joined',
        {
          id: hub.phones[0]?.id,
          viewport: { width: 800, height: 360 },
          devicePixelRatio: 3,
        },
      ],
    ])
  })

  it('reports each phone once, however often the list changes', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    bindDisplayToHub(display, hub)
    pair(hub)
    pair(hub)
    expect(log.filter(([kind]) => kind === 'joined')).toHaveLength(2)
  })

  it('forwards stream.request and stream.stop with the phone id', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    bindDisplayToHub(display, hub)
    const { handlers } = pair(hub)
    const id = hub.phones[0]?.id
    handlers.onMessage(
      JSON.stringify({
        type: 'stream.request',
        size: { width: 1440, height: 1080 },
        quality: 'full',
      }),
    )
    handlers.onMessage(JSON.stringify({ type: 'stream.stop' }))
    expect(log.slice(1)).toEqual([
      ['request', id, { width: 1440, height: 1080 }, undefined],
      ['stop', id],
    ])
  })

  it('hands the controller the viewport a stream.request carries', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    bindDisplayToHub(display, hub)
    // Paired in portrait; the phone has since rotated and reports what it really has.
    const { handlers } = pair(hub, { width: 412, height: 800 })
    const id = hub.phones[0]?.id
    handlers.onMessage(
      JSON.stringify({
        type: 'stream.request',
        size: { width: 1680, height: 1080 },
        quality: 'full',
        device: { viewport: { width: 892, height: 412 }, devicePixelRatio: 2.625 },
      }),
    )
    expect(log.slice(1)).toEqual([
      [
        'request',
        id,
        { width: 1680, height: 1080 },
        { viewport: { width: 892, height: 412 }, devicePixelRatio: 2.625 },
      ],
    ])
  })

  it('does not forward a stream.request whose viewport is not valid', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    bindDisplayToHub(display, hub)
    const { handlers, sent } = pair(hub)
    handlers.onMessage(
      JSON.stringify({
        type: 'stream.request',
        size: { width: 1680, height: 1080 },
        quality: 'full',
        device: { viewport: { width: -1, height: 412 }, devicePixelRatio: 2 },
      }),
    )
    expect(log.map(([kind]) => kind)).toEqual(['joined'])
    expect(sent.at(-1)).toMatchObject({ type: 'error', code: 'bad-message' })
  })

  it('tells the controller when a phone leaves', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    bindDisplayToHub(display, hub)
    const { handlers } = pair(hub)
    const id = hub.phones[0]?.id
    handlers.onClose()
    expect(log.at(-1)).toEqual(['left', id])
  })

  it('sends the phone display-unavailable when its monitor failed, and when it is taken', () => {
    const hub = makeHub()
    const { display, emitter } = fakeDisplay()
    bindDisplayToHub(display, hub)
    const { sent } = pair(hub)
    const id = hub.phones[0]?.id
    emitter.emit('failed', {
      phoneId: id,
      problem: { reason: 'driver-missing', message: 'no driver' },
    })
    emitter.emit('preempted', { phoneId: id, by: 'other' })
    expect(sent.slice(1)).toEqual([
      { type: 'error', code: 'display-unavailable', message: 'no driver' },
      {
        type: 'error',
        code: 'display-unavailable',
        message: 'Another phone is using the PC monitor.',
      },
    ])
  })

  it('stops listening once unbound', () => {
    const hub = makeHub()
    const { display, log } = fakeDisplay()
    const unbind = bindDisplayToHub(display, hub)
    unbind()
    pair(hub)
    expect(log).toEqual([])
  })
})
