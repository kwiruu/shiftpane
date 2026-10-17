import { EventEmitter } from 'node:events'
import type { PcMessage } from '@shiftpane/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { PhoneInfo } from '../server/phone-hub.ts'
import type { Rect } from './match.ts'
import { listMonitors, MonitorAnnouncer, type MonitorScreen } from './monitors.ts'

interface FakeDisplay {
  id: number
  label: string
  bounds: Rect
}

const mi: FakeDisplay = {
  id: 4027384433,
  label: 'Mi Monitor',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
}
const hp: FakeDisplay = {
  id: 396830892,
  label: 'HP 524pf',
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
}
const vdd: FakeDisplay = {
  id: 7,
  label: 'VDD by MTT',
  bounds: { x: 3840, y: 0, width: 1080, height: 1440 },
}

function fakeScreen(displays: () => FakeDisplay[], primary = mi.id, scale = 1): MonitorScreen {
  return {
    getAllDisplays: displays,
    getPrimaryDisplay: () => ({ id: primary }),
    dipToScreenRect: (_window, rect) => ({
      x: rect.x * scale,
      y: rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    }),
  }
}

describe('listMonitors', () => {
  it('lists the main display first, then left to right, in physical pixels', () => {
    const screen = fakeScreen(() => [hp, mi], hp.id, 1.25)
    expect(listMonitors(screen, null)).toEqual([
      { id: '396830892', name: 'HP 524pf', width: 2400, height: 1350, primary: true },
      { id: '4027384433', name: 'Mi Monitor', width: 2400, height: 1350, primary: false },
    ])
  })

  it('leaves out the virtual monitor ShiftPane attached', () => {
    const screen = fakeScreen(() => [mi, hp, vdd])
    expect(listMonitors(screen, vdd.bounds).map((m) => m.name)).toEqual(['Mi Monitor', 'HP 524pf'])
    expect(listMonitors(screen, null)).toHaveLength(3)
  })
})

function harness(displays: () => FakeDisplay[]) {
  vi.useFakeTimers()
  const hubEvents = new EventEmitter()
  const displayEvents = new EventEmitter()
  const sent: Array<{ id: string; message: PcMessage }> = []
  let phones: PhoneInfo[] = []
  let onScreenChange = () => {}
  const announcer = new MonitorAnnouncer({
    hub: {
      on: hubEvents.on.bind(hubEvents),
      off: hubEvents.off.bind(hubEvents),
      send: (id: string, message: PcMessage) => {
        sent.push({ id, message })
        return true
      },
      get phones() {
        return phones
      },
    } as never,
    display: displayEvents as never,
    screen: fakeScreen(displays),
    watch: (listener) => {
      onScreenChange = listener
      return () => {}
    },
    debounceMs: 100,
  })
  const phone = (id: string): PhoneInfo => ({
    id,
    name: id,
    address: '192.168.1.4',
    viewport: { width: 390, height: 844 },
    devicePixelRatio: 3,
    connectedAt: 0,
    screen: null,
  })
  return {
    announcer,
    sent,
    pair: (...ids: string[]) => {
      phones = ids.map(phone)
      hubEvents.emit('change', phones)
    },
    screenChanged: () => onScreenChange(),
    attached: (bounds: Rect) =>
      displayEvents.emit('attached', { phoneId: 'a', display: { ...bounds, id: 'x', name: '' } }),
  }
}

describe('MonitorAnnouncer', () => {
  it('sends the list to a phone as soon as it pairs, once', () => {
    const t = harness(() => [mi, hp])
    t.pair('a')
    t.pair('a')
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({ id: 'a', message: { type: 'monitors' } })
    t.announcer.stop()
    vi.useRealTimers()
  })

  it('tells every phone when monitors change, after the burst, and not when nothing changed', () => {
    let displays = [mi, hp]
    const t = harness(() => displays)
    t.pair('a', 'b')
    t.sent.length = 0
    t.screenChanged()
    vi.advanceTimersByTime(150)
    expect(t.sent).toEqual([])
    displays = [mi]
    t.screenChanged()
    t.screenChanged()
    vi.advanceTimersByTime(150)
    expect(t.sent.map((s) => s.id)).toEqual(['a', 'b'])
    t.announcer.stop()
    vi.useRealTimers()
  })

  it('drops the virtual monitor from the list once it is attached', () => {
    const t = harness(() => [mi, hp, vdd])
    t.pair('a')
    const first = t.sent[0]?.message
    expect(first?.type === 'monitors' && first.monitors).toHaveLength(3)
    t.attached(vdd.bounds)
    vi.advanceTimersByTime(150)
    const second = t.sent[1]?.message
    expect(second?.type === 'monitors' && second.monitors.map((m) => m.name)).toEqual([
      'Mi Monitor',
      'HP 524pf',
    ])
    t.announcer.stop()
    vi.useRealTimers()
  })
})
