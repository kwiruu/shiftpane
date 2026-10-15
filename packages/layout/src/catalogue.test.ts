import { describe, expect, it } from 'vitest'
import { MONITOR_SIZES, pickMonitorSize } from './catalogue.ts'
import { MAX_STREAM, MIN_STREAM } from './split.ts'

describe('MONITOR_SIZES', () => {
  it('stays within what the driver can hold', () => {
    expect(MONITOR_SIZES.length).toBeLessThanOrEqual(14)
  })

  it('has unique, even sizes the drivers accept', () => {
    const keys = MONITOR_SIZES.map((s) => `${s.width}x${s.height}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const { width, height } of MONITOR_SIZES) {
      expect(width % 2).toBe(0)
      expect(height % 2).toBe(0)
      expect(width).toBeGreaterThanOrEqual(MIN_STREAM.width)
      expect(height).toBeGreaterThanOrEqual(MIN_STREAM.height)
      expect(width).toBeLessThanOrEqual(MAX_STREAM.width)
      expect(height).toBeLessThanOrEqual(MAX_STREAM.height)
    }
  })

  it('keeps the driver defaults and the sizes verified together on real hardware', () => {
    const keys = new Set(MONITOR_SIZES.map((s) => `${s.width}x${s.height}`))
    for (const key of ['800x600', '1366x768', '1920x1080', '2560x1440', '3840x2160']) {
      expect(keys.has(key), key).toBe(true)
    }
    expect(keys.has('1440x1080')).toBe(true)
  })
})

describe('pickMonitorSize', () => {
  it('returns the plan example unchanged', () => {
    expect(pickMonitorSize({ width: 1440, height: 1080 })).toEqual({ width: 1440, height: 1080 })
  })

  it('maps an iPhone in portrait at each split to a portrait or near-square size', () => {
    // 1179x2085 physical pixels: monitor only, 70/30 and 50/50 of the long axis.
    expect(pickMonitorSize({ width: 1179, height: 2085 })).toEqual({ width: 1080, height: 1920 })
    expect(pickMonitorSize({ width: 1179, height: 1460 })).toEqual({ width: 1080, height: 1440 })
    expect(pickMonitorSize({ width: 1179, height: 1042 })).toEqual({ width: 1080, height: 1080 })
  })

  it('maps a phone in landscape to a landscape size', () => {
    expect(pickMonitorSize({ width: 2085, height: 1179 })).toEqual({ width: 1920, height: 1080 })
    expect(pickMonitorSize({ width: 1460, height: 1179 })).toEqual({ width: 1440, height: 1080 })
  })

  it('tells equally shaped sizes apart by how close their pixel count is', () => {
    expect(pickMonitorSize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 })
    // 1366x768 is the same shape within a hair, but 1920x1080 is nearer in size.
    expect(pickMonitorSize({ width: 1700, height: 956 })).toEqual({ width: 1920, height: 1080 })
    expect(pickMonitorSize({ width: 1400, height: 787 })).toEqual({ width: 1366, height: 768 })
  })

  it('uses the largest size when nothing is big enough', () => {
    expect(pickMonitorSize({ width: 7680, height: 4320 })).toEqual({ width: 3840, height: 2160 })
  })

  it('always returns a catalogue member and rejects a non-positive target', () => {
    const keys = new Set(MONITOR_SIZES.map((s) => `${s.width}x${s.height}`))
    for (const target of [
      { width: 640, height: 480 },
      { width: 1000, height: 3000 },
      { width: 3000, height: 1000 },
      { width: 777, height: 555 },
    ]) {
      const picked = pickMonitorSize(target)
      expect(keys.has(`${picked.width}x${picked.height}`), JSON.stringify(target)).toBe(true)
    }
    expect(() => pickMonitorSize({ width: 0, height: 100 })).toThrow(RangeError)
  })
})
