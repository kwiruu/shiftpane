import { describe, expect, it } from 'vitest'
import type { HelperDisplay, Rect, ScreenSource } from './match.ts'
import { CaptureSourceError, findCaptureSource, type ScreenModule } from './source.ts'

const target: HelperDisplay = {
  id: '\\\\.\\DISPLAY8',
  name: 'VDD by MTT',
  x: 5760,
  y: 0,
  width: 800,
  height: 600,
}

interface FakeDisplay {
  id: number
  label: string
  bounds: Rect
}

/** A desktop at 100% scaling, so DIPs and pixels are the same. */
function fakeScreen(displays: () => FakeDisplay[]) {
  const calls: string[] = []
  const screen: ScreenModule = {
    getAllDisplays: () => {
      calls.push('displays')
      return displays()
    },
    dipToScreenRect: (_window, rect) => rect,
  }
  return { screen, calls }
}

const virtualDisplay: FakeDisplay = {
  id: 4242,
  label: 'VDD by MTT',
  bounds: { x: 5760, y: 0, width: 800, height: 600 },
}
const physicalDisplay: FakeDisplay = {
  id: 1,
  label: 'Mi Monitor',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
}

const noWait = async () => {}

describe('findCaptureSource', () => {
  it('returns the source of the display at the helper rectangle', async () => {
    const { screen } = fakeScreen(() => [physicalDisplay, virtualDisplay])
    const sources: ScreenSource[] = [
      { id: 'screen:0:0', name: 'Screen 1', display_id: '1' },
      { id: 'screen:1:0', name: 'Screen 2', display_id: '4242' },
    ]
    const found = await findCaptureSource(
      target,
      screen,
      { getSources: async () => sources },
      { sleep: noWait },
    )
    expect(found.source.id).toBe('screen:1:0')
    expect(found.by).toBe('bounds')
  })

  it('lists displays before asking for sources, which is what fills display_id', async () => {
    const order: string[] = []
    const { screen } = fakeScreen(() => {
      order.push('displays')
      return [virtualDisplay]
    })
    await findCaptureSource(
      target,
      screen,
      {
        getSources: async () => {
          order.push('sources')
          return [{ id: 'screen:0:0', name: 'Screen 1', display_id: '4242' }]
        },
      },
      { sleep: noWait },
    )
    expect(order.slice(0, 2)).toEqual(['displays', 'sources'])
  })

  it('waits for Electron to notice a monitor the helper has already created', async () => {
    let calls = 0
    const { screen } = fakeScreen(() => {
      calls += 1
      return calls < 4 ? [physicalDisplay] : [physicalDisplay, virtualDisplay]
    })
    const sleeps: number[] = []
    const found = await findCaptureSource(
      target,
      screen,
      { getSources: async () => [{ id: 'screen:1:0', name: 'S', display_id: '4242' }] },
      {
        intervalMs: 50,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
    )
    expect(found.source.id).toBe('screen:1:0')
    expect(sleeps).toEqual([50, 50, 50])
  })

  it('also waits when the display is known but its capture source is not yet', async () => {
    const { screen } = fakeScreen(() => [virtualDisplay])
    let asked = 0
    const found = await findCaptureSource(
      target,
      screen,
      {
        getSources: async () => {
          asked += 1
          return asked < 3 ? [] : [{ id: 'screen:1:0', name: 'S', display_id: '4242' }]
        },
      },
      { sleep: noWait },
    )
    expect(found.source.id).toBe('screen:1:0')
    expect(asked).toBe(3)
  })

  it('gives up with a message for the user, and lists what it saw in the log', async () => {
    const { screen } = fakeScreen(() => [physicalDisplay])
    const log: string[] = []
    const attempt = findCaptureSource(
      target,
      screen,
      { getSources: async () => [] },
      { attempts: 3, sleep: noWait, log: (message) => log.push(message) },
    )
    await expect(attempt).rejects.toBeInstanceOf(CaptureSourceError)
    await expect(attempt).rejects.toThrow(/no display is at 5760,0 800x600/)
    expect(log.join('\n')).toContain('1 "Mi Monitor" 1920x1080@0,0')
  })

  it('does not capture a monitor that only looks similar', async () => {
    const lookalike: FakeDisplay = {
      id: 2,
      label: 'HP 524pf',
      bounds: { x: 1920, y: 0, width: 800, height: 600 },
    }
    const { screen } = fakeScreen(() => [physicalDisplay, lookalike])
    let asked = false
    const attempt = findCaptureSource(
      target,
      screen,
      {
        getSources: async () => {
          asked = true
          return [{ id: 'screen:1:0', name: 'S', display_id: '2' }]
        },
      },
      { attempts: 2, sleep: noWait },
    )
    await expect(attempt).rejects.toBeInstanceOf(CaptureSourceError)
    expect(asked).toBe(false)
  })

  it('stops looking at once when two displays are equally likely', async () => {
    const a: FakeDisplay = {
      id: 9,
      label: 'VDD by MTT',
      bounds: { x: 6000, y: 0, width: 800, height: 600 },
    }
    const b: FakeDisplay = {
      id: 10,
      label: 'VDD by MTT',
      bounds: { x: 7000, y: 0, width: 800, height: 600 },
    }
    const { screen, calls } = fakeScreen(() => [a, b])
    await expect(
      findCaptureSource(target, screen, { getSources: async () => [] }, { sleep: noWait }),
    ).rejects.toThrow(/more than one display/)
    // One look, plus the one the failure report makes.
    expect(calls.length).toBe(2)
  })
})
