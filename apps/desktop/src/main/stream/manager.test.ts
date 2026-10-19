import { EventEmitter } from 'node:events'
import type { DisplayInfo } from '@shiftpane/helper-client'
import type { PcMessage, PhoneMessage } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import type { CaptureCommand, CaptureEvent } from '../../shared/capture.ts'
import type { PhoneInfo } from '../server/phone-hub.ts'
import { type CaptureBridge, StreamManager } from './manager.ts'

const display = (overrides: Partial<DisplayInfo> = {}): DisplayInfo => ({
  id: '\\\\.\\DISPLAY8',
  name: 'VDD by MTT',
  x: 5760,
  y: 0,
  width: 800,
  height: 600,
  refreshHz: 60,
  scaleFactor: 1,
  primary: false,
  virtualDisplay: true,
  ...overrides,
})

const phone = (id: string, address = '192.168.1.42'): PhoneInfo => ({
  id,
  deviceId: `device-${id}`,
  name: id,
  address,
  viewport: { width: 800, height: 360 },
  devicePixelRatio: 3,
  connectedAt: 0,
  screen: null,
})

/** Lets a test hold an `arm` call open and decide how it ends. */
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(
  arm: (display: DisplayInfo) => Promise<void> = async () => {},
  armMirror?: (displayId: string) => Promise<void>,
) {
  const displayEvents = new EventEmitter()
  const hubEvents = new EventEmitter()
  const sentToPhone: Array<{ id: string; message: PcMessage }> = []
  const commands: CaptureCommand[] = []
  const armed: DisplayInfo[] = []
  let captureListener: ((event: CaptureEvent) => void) | null = null
  let unhooked = 0

  const bridge: CaptureBridge = {
    send: (command) => commands.push(command),
    onEvent: (listener) => {
      captureListener = listener
      return () => {
        unhooked += 1
        captureListener = null
      }
    },
  }
  const manager = new StreamManager({
    display: displayEvents as never,
    hub: {
      on: hubEvents.on.bind(hubEvents),
      off: hubEvents.off.bind(hubEvents),
      send: (id: string, message: PcMessage) => {
        sentToPhone.push({ id, message })
        return true
      },
    } as never,
    bridge,
    arm: async (info) => {
      armed.push(info)
      await arm(info)
    },
    ...(armMirror ? { armMirror } : {}),
  })

  return {
    manager,
    commands,
    armed,
    sentToPhone,
    get unhooked() {
      return unhooked
    },
    attach: (phoneId: string, info = display()) =>
      displayEvents.emit('attached', { phoneId, display: info }),
    detach: (phoneId: string) => displayEvents.emit('detached', { phoneId }),
    phones: (...ids: string[]) =>
      hubEvents.emit(
        'change',
        ids.map((id) => phone(id)),
      ),
    fromPhone: (id: string, message: PhoneMessage, address?: string) =>
      hubEvents.emit('message', phone(id, address), message),
    fromCapture: (event: CaptureEvent) => captureListener?.(event),
  }
}

/** Lets the manager's pending `arm` promises settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

const answer = (session: number): PhoneMessage => ({
  type: 'rtc.signal',
  session,
  signal: { kind: 'answer', sdp: 'v=0' },
})

describe('StreamManager', () => {
  it('captures the attached monitor and starts a session for its phone', async () => {
    const t = setup()
    t.attach('a', display({ width: 1680, height: 1080 }))
    await settle()
    expect(t.armed).toEqual([display({ width: 1680, height: 1080 })])
    expect(t.commands).toEqual([{ type: 'start', session: 1 }])
  })

  it('swaps the captured source when the same phone gets a resized monitor', async () => {
    const t = setup()
    t.attach('a')
    await settle()
    t.attach('a', display({ id: '\\\\.\\DISPLAY9', width: 1680, height: 1080 }))
    await settle()
    expect(t.armed).toHaveLength(2)
    expect(t.commands).toEqual([
      { type: 'start', session: 1 },
      { type: 'recapture', session: 1 },
    ])
  })

  it('stops the session when the monitor is detached, and starts a fresh one after', async () => {
    const t = setup()
    t.attach('a')
    await settle()
    t.detach('a')
    expect(t.commands.at(-1)).toEqual({ type: 'stop', session: 1 })
    t.attach('a')
    await settle()
    expect(t.commands.at(-1)).toEqual({ type: 'start', session: 2 })
  })

  it('stops when the phone disconnects', async () => {
    const t = setup()
    t.attach('a')
    await settle()
    t.phones('a')
    expect(t.commands.at(-1)).not.toEqual({ type: 'stop', session: 1 })
    t.phones()
    expect(t.commands.at(-1)).toEqual({ type: 'stop', session: 1 })
  })

  it('moves the stream to another phone when the monitor changes hands', async () => {
    const t = setup()
    t.attach('a')
    await settle()
    t.detach('a')
    t.attach('b')
    await settle()
    expect(t.commands).toEqual([
      { type: 'start', session: 1 },
      { type: 'stop', session: 1 },
      { type: 'start', session: 2 },
    ])
    // The old phone's late answer is not applied to the new session.
    t.fromPhone('a', answer(1))
    t.fromPhone('b', answer(1))
    expect(t.commands).toHaveLength(3)
    t.fromPhone('b', answer(2))
    expect(t.commands.at(-1)).toEqual(answer(2))
  })

  it('ends the previous phone first when a new owner arrives without a detach', async () => {
    const t = setup()
    t.attach('a')
    await settle()
    t.attach('b')
    await settle()
    expect(t.commands.slice(1)).toEqual([
      { type: 'stop', session: 1 },
      { type: 'start', session: 2 },
    ])
  })

  describe('signaling', () => {
    it('relays the offer and the PC candidates to the phone', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      const offer: CaptureEvent = {
        type: 'rtc.signal',
        session: 1,
        signal: { kind: 'offer', sdp: 'v=0' },
      }
      t.fromCapture(offer)
      expect(t.sentToPhone).toEqual([{ id: 'a', message: offer }])
    })

    it("relays the phone's answer to the capture page", async () => {
      const t = setup()
      t.attach('a')
      await settle()
      t.fromPhone('a', answer(1))
      expect(t.commands.at(-1)).toEqual(answer(1))
    })

    it('rewrites a phone candidate that only has an mDNS name', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      t.fromPhone(
        'a',
        {
          type: 'rtc.signal',
          session: 1,
          signal: {
            kind: 'candidate',
            candidate: 'candidate:1 1 udp 1677729535 abc.local 50000 typ host generation 0',
            sdpMid: '0',
            sdpMLineIndex: 0,
          },
        },
        '::ffff:192.168.1.77',
      )
      expect(t.commands.at(-1)).toMatchObject({
        signal: {
          candidate: 'candidate:1 1 udp 1677729535 192.168.1.77 50000 typ host generation 0',
        },
      })
    })

    it('drops signals from the wrong phone, the wrong session or with no session at all', async () => {
      const t = setup()
      t.fromPhone('a', answer(1))
      t.attach('a')
      await settle()
      t.fromPhone('b', answer(1))
      t.fromPhone('a', answer(2))
      t.fromCapture({ type: 'rtc.signal', session: 9, signal: { kind: 'offer', sdp: 'v=0' } })
      expect(t.commands).toEqual([{ type: 'start', session: 1 }])
      expect(t.sentToPhone).toEqual([])
    })

    it('does not forward anything after the session ended', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      t.detach('a')
      t.fromPhone('a', answer(1))
      t.fromCapture({ type: 'rtc.signal', session: 1, signal: { kind: 'offer', sdp: 'v=0' } })
      expect(t.commands.at(-1)).toEqual({ type: 'stop', session: 1 })
      expect(t.sentToPhone).toEqual([])
    })
  })

  describe('stream.ready and failures', () => {
    it('tells the phone video is flowing, with the size that is flowing', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      t.fromCapture({ type: 'flowing', session: 1, size: { width: 800, height: 600 } })
      expect(t.sentToPhone).toEqual([
        { id: 'a', message: { type: 'stream.ready', size: { width: 800, height: 600 } } },
      ])
    })

    it('does not say ready before the capture page does', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      expect(t.sentToPhone).toEqual([])
    })

    it('reports a capture page failure to the phone and ends the session', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      t.fromCapture({ type: 'failed', session: 1, message: 'Capture was denied.' })
      expect(t.sentToPhone).toEqual([
        {
          id: 'a',
          message: { type: 'error', code: 'display-unavailable', message: 'Capture was denied.' },
        },
      ])
      expect(t.commands.at(-1)).toEqual({ type: 'stop', session: 1 })
    })

    it('reports a monitor it cannot find, without starting anything', async () => {
      const t = setup(async () => {
        throw new Error('Could not capture the virtual monitor: no display is at 5760,0 800x600.')
      })
      t.attach('a')
      await settle()
      expect(t.commands).toEqual([])
      expect(t.sentToPhone).toEqual([
        {
          id: 'a',
          message: {
            type: 'error',
            code: 'display-unavailable',
            message: 'Could not capture the virtual monitor: no display is at 5760,0 800x600.',
          },
        },
      ])
    })
  })

  describe('while the capture source is being looked up', () => {
    it('starts nothing for a monitor that was detached in the meantime', async () => {
      const lookup = deferred()
      const t = setup(() => lookup.promise)
      t.attach('a')
      t.detach('a')
      lookup.resolve()
      await settle()
      expect(t.commands).toEqual([])
    })

    it('starts nothing for a phone that left in the meantime', async () => {
      const lookup = deferred()
      const t = setup(() => lookup.promise)
      t.phones('a')
      t.attach('a')
      t.phones()
      lookup.resolve()
      await settle()
      expect(t.commands).toEqual([])
    })

    it('only uses the latest lookup when the monitor is resized again', async () => {
      const first = deferred()
      const second = deferred()
      const lookups = [first, second]
      const t = setup(() => (lookups.shift() as ReturnType<typeof deferred>).promise)
      t.attach('a', display({ width: 800 }))
      t.attach('a', display({ width: 900 }))
      second.resolve()
      await settle()
      first.resolve()
      await settle()
      expect(t.commands).toEqual([{ type: 'start', session: 1 }])
    })

    it('does not report a failed lookup that was already replaced', async () => {
      const first = deferred()
      const second = deferred()
      const lookups = [first, second]
      const t = setup(() => (lookups.shift() as ReturnType<typeof deferred>).promise)
      t.attach('a')
      t.attach('a')
      first.reject(new Error('old monitor is gone'))
      second.resolve()
      await settle()
      expect(t.sentToPhone).toEqual([])
      expect(t.commands).toEqual([{ type: 'start', session: 1 }])
    })

    it('does not mistake another phone leaving for the lookup being cancelled', async () => {
      const lookup = deferred()
      const t = setup(() => lookup.promise)
      t.phones('a', 'b')
      t.attach('a')
      t.phones('a')
      lookup.resolve()
      await settle()
      expect(t.commands).toEqual([{ type: 'start', session: 1 }])
    })
  })

  describe('stop', () => {
    it('ends the session and lets go of everything', async () => {
      const t = setup()
      t.attach('a')
      await settle()
      t.manager.stop()
      expect(t.commands.at(-1)).toEqual({ type: 'stop', session: 1 })
      expect(t.unhooked).toBe(1)
      t.attach('a')
      await settle()
      expect(t.commands).toHaveLength(2)
    })
  })
})

describe('StreamManager: duplicating a real monitor', () => {
  const mirror = (displayId: string): PhoneMessage => ({
    type: 'stream.request',
    size: { width: 1680, height: 1080 },
    quality: 'full',
    source: { kind: 'mirror', displayId },
  })
  const virtual: PhoneMessage = {
    type: 'stream.request',
    size: { width: 1680, height: 1080 },
    quality: 'full',
    source: { kind: 'virtual' },
  }

  function mirrorSetup(armMirror: (displayId: string) => Promise<void> = async () => {}) {
    const mirrored: string[] = []
    const t = setup(undefined, async (id) => {
      mirrored.push(id)
      await armMirror(id)
    })
    t.phones('a')
    return { ...t, mirrored }
  }

  it('captures the chosen monitor and starts a session for the phone', async () => {
    const t = mirrorSetup()
    t.fromPhone('a', mirror('4027384433'))
    await settle()
    expect(t.mirrored).toEqual(['4027384433'])
    expect(t.armed).toEqual([])
    expect(t.commands).toEqual([{ type: 'start', session: 1 }])
  })

  it('swaps from the virtual monitor to the copy in the same session, and survives its removal', async () => {
    const t = mirrorSetup()
    t.attach('a')
    await settle()
    t.fromPhone('a', mirror('1'))
    await settle()
    // Choosing a copy removes the virtual monitor; that must not stop the copy.
    t.detach('a')
    await settle()
    expect(t.commands).toEqual([
      { type: 'start', session: 1 },
      { type: 'recapture', session: 1 },
    ])
  })

  it('does not capture again when the phone repeats the same request', async () => {
    const t = mirrorSetup()
    t.fromPhone('a', mirror('1'))
    await settle()
    t.fromPhone('a', mirror('1'))
    await settle()
    expect(t.mirrored).toEqual(['1'])
    t.fromPhone('a', mirror('2'))
    await settle()
    expect(t.mirrored).toEqual(['1', '2'])
    expect(t.commands).toEqual([
      { type: 'start', session: 1 },
      { type: 'recapture', session: 1 },
    ])
  })

  it('ends the copy when the phone stops, or goes back to the virtual monitor', async () => {
    const t = mirrorSetup()
    t.fromPhone('a', mirror('1'))
    await settle()
    t.fromPhone('a', { type: 'stream.stop' })
    t.fromPhone('a', mirror('1'))
    await settle()
    t.fromPhone('a', virtual)
    t.attach('a')
    await settle()
    expect(t.commands).toEqual([
      { type: 'start', session: 1 },
      { type: 'stop', session: 1 },
      { type: 'start', session: 2 },
      { type: 'stop', session: 2 },
      { type: 'start', session: 3 },
    ])
  })

  it('ignores a virtual monitor that attaches after the phone chose a copy', async () => {
    const t = mirrorSetup()
    t.fromPhone('a', mirror('1'))
    await settle()
    t.attach('a')
    await settle()
    expect(t.armed).toEqual([])
    expect(t.commands).toEqual([{ type: 'start', session: 1 }])
  })

  it('tells the phone when the monitor cannot be captured', async () => {
    const t = mirrorSetup(async () => {
      throw new Error('That monitor is no longer connected to the PC.')
    })
    t.fromPhone('a', mirror('9'))
    await settle()
    expect(t.commands).toEqual([])
    expect(t.sentToPhone).toEqual([
      {
        id: 'a',
        message: {
          type: 'error',
          code: 'display-unavailable',
          message: 'That monitor is no longer connected to the PC.',
        },
      },
    ])
  })

  it('refuses a copy when the PC has no way to capture one', async () => {
    const t = setup()
    t.phones('a')
    t.fromPhone('a', mirror('1'))
    await settle()
    expect(t.sentToPhone[0]?.message).toMatchObject({ type: 'error', code: 'display-unavailable' })
  })

  it('forgets the choice when the phone leaves', async () => {
    const t = mirrorSetup()
    t.fromPhone('a', mirror('1'))
    await settle()
    t.phones()
    expect(t.commands.at(-1)).toEqual({ type: 'stop', session: 1 })
  })
})
