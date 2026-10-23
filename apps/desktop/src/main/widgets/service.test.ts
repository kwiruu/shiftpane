import { EventEmitter } from 'node:events'
import type { MediaAction, PcMessage, PhoneMessage } from '@shiftpane/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhoneInfo } from '../server/phone-hub.ts'
import { type WidgetCollector, type WidgetData, WidgetService } from './service.ts'

const phone = (id: string): PhoneInfo => ({
  id,
  deviceId: `device-${id}`,
  name: id,
  address: '192.168.1.4',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  connectedAt: 0,
  screen: null,
})

function collector(values: WidgetData[], extra: Partial<WidgetCollector> = {}) {
  let index = 0
  const runs = { count: 0 }
  const widget: WidgetCollector = {
    intervalMs: 1000,
    collect: async () => {
      runs.count += 1
      const value = values[Math.min(index, values.length - 1)] ?? null
      index += 1
      return value
    },
    ...extra,
  }
  return { widget, runs }
}

function setup(
  collectors: Record<string, WidgetCollector>,
  mediaControl?: (action: MediaAction) => Promise<void>,
) {
  const events = new EventEmitter()
  const sent: Array<{ id: string; message: PcMessage }> = []
  const service = new WidgetService({
    hub: {
      on: events.on.bind(events),
      off: events.off.bind(events),
      send: (id: string, message: PcMessage) => {
        sent.push({ id, message })
        return true
      },
    } as never,
    collectors,
    ...(mediaControl ? { mediaControl, mediaWidget: 'media' } : {}),
    mediaRefreshDelayMs: 10,
    now: () => 42,
  })
  return {
    service,
    sent,
    from: (id: string, message: PhoneMessage) => events.emit('message', phone(id), message),
    phones: (...ids: string[]) => events.emit('change', ids.map(phone)),
    subscribe: (id: string, widgets: string[]) =>
      events.emit('message', phone(id), { type: 'widgets.subscribe', widgets }),
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('WidgetService', () => {
  it('retains the last good calendar when a later refresh fails', async () => {
    let fail = false
    const calendar = { days: [{ date: '2026-10-23', count: 4, level: 2 }] }
    const t = setup({
      'github-contributions': {
        intervalMs: 1000,
        collect: async () => {
          if (fail) throw new Error('GitHub is unavailable')
          return calendar
        },
      },
    })
    t.subscribe('a', ['github-contributions'])
    await flush()
    expect(t.sent).toHaveLength(1)
    fail = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.sent).toHaveLength(1)
    t.subscribe('b', ['github-contributions'])
    await flush()
    const last = t.sent.at(-1)?.message
    expect(last?.type === 'widget.update' && last.data).toEqual(calendar)
    t.service.stop()
  })

  it('runs a collector only while a phone shows its widget, and sends to that phone', async () => {
    const stats = collector([{ cpu: 1 }, { cpu: 2 }, { cpu: 3 }])
    const t = setup({ 'pc-stats': stats.widget })
    t.phones('a', 'b')
    await flush()
    expect(stats.runs.count).toBe(0)

    t.subscribe('a', ['pc-stats'])
    await flush()
    expect(t.sent).toEqual([
      {
        id: 'a',
        message: {
          type: 'widget.update',
          instanceId: 'pc-stats',
          widgetId: 'pc-stats',
          data: { cpu: 1 },
          at: 42,
        },
      },
    ])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.sent.map((s) => s.id)).toEqual(['a', 'a'])

    t.subscribe('a', [])
    await vi.advanceTimersByTimeAsync(5000)
    expect(stats.runs.count).toBe(2)
    t.service.stop()
  })

  it('gives a phone that subscribes later the latest data straight away', async () => {
    const stats = collector([{ cpu: 1 }])
    const t = setup({ 'pc-stats': stats.widget })
    t.subscribe('a', ['pc-stats'])
    await flush()
    t.subscribe('b', ['pc-stats'])
    expect(t.sent.at(-1)).toMatchObject({ id: 'b', message: { data: { cpu: 1 } } })
    expect(stats.runs.count).toBe(1)
    t.service.stop()
  })

  it('sends a change-only widget again only when its data changes', async () => {
    const media = collector([{ title: 'A' }, { title: 'A' }, { title: 'B' }], {
      onlyOnChange: true,
    })
    const t = setup({ media: media.widget })
    t.subscribe('a', ['media'])
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.sent.map((s) => (s.message as { data: unknown }).data)).toEqual([
      { title: 'A' },
      { title: 'B' },
    ])
    t.service.stop()
  })

  it('ignores widget ids it has no collector for, including prototype names', async () => {
    const t = setup({})
    t.subscribe('a', ['constructor', 'weather'])
    await flush()
    expect(t.sent).toEqual([])
    t.service.stop()
  })

  it('stops collecting for a phone that disconnected', async () => {
    const stats = collector([{ cpu: 1 }])
    const t = setup({ 'pc-stats': stats.widget })
    t.phones('a')
    t.subscribe('a', ['pc-stats'])
    await flush()
    t.phones()
    await vi.advanceTimersByTimeAsync(5000)
    expect(stats.runs.count).toBe(1)
    t.service.stop()
  })

  it('presses a media button and refreshes the media widget soon after', async () => {
    const presses: MediaAction[] = []
    const media = collector([{ status: 'paused' }, { status: 'playing' }], { onlyOnChange: true })
    const t = setup({ media: media.widget }, async (action) => {
      presses.push(action)
    })
    t.subscribe('a', ['media'])
    await flush()
    t.from('a', { type: 'media.control', action: 'play-pause' })
    await vi.advanceTimersByTimeAsync(20)
    expect(presses).toEqual(['play-pause'])
    const last = t.sent.at(-1)?.message
    expect(last?.type === 'widget.update' && last.data).toEqual({ status: 'playing' })
    t.service.stop()
  })

  it('keeps going when a collector fails', async () => {
    let fail = true
    const flaky: WidgetCollector = {
      intervalMs: 1000,
      collect: async () => {
        if (fail) throw new Error('helper gone')
        return { ok: true }
      },
    }
    const t = setup({ 'pc-stats': flaky })
    t.subscribe('a', ['pc-stats'])
    await flush()
    expect(t.sent).toEqual([])
    fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.sent).toHaveLength(1)
    t.service.stop()
  })

  it('starts a widget a phone already shows once it gets a collector', async () => {
    const t = setup({})
    t.subscribe('a', ['gpu-ring'])
    await flush()
    expect(t.sent).toEqual([])
    const ring = collector([{ percent: 40 }])
    t.service.setCollectors({ 'gpu-ring': ring.widget })
    await flush()
    expect(
      t.sent.map(({ id, message }) => [id, message.type === 'widget.update' && message.data]),
    ).toEqual([['a', { percent: 40 }]])
    t.service.stop()
  })

  it('restarts a widget whose collector was replaced, and stops one that was removed', async () => {
    const before = collector([{ version: 1 }])
    const t = setup({ 'gpu-ring': before.widget })
    t.subscribe('a', ['gpu-ring'])
    await flush()
    const after = collector([{ version: 2 }])
    t.service.setCollectors({ 'gpu-ring': after.widget })
    await flush()
    expect(after.runs.count).toBe(1)
    t.service.setCollectors({})
    await vi.advanceTimersByTimeAsync(5000)
    expect(before.runs.count).toBe(1)
    expect(after.runs.count).toBe(1)
    t.service.stop()
  })
})
