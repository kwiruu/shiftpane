import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeSplit, MAX_STREAM, MIN_STREAM, minMonitorFraction, SPLIT_PRESETS } from './split.ts'

// 2400x1080 physical, DPR 3 => 800x360 CSS.
const phoneLandscape = { viewport: { width: 800, height: 360 }, devicePixelRatio: 3 }
const phonePortrait = { viewport: { width: 360, height: 800 }, devicePixelRatio: 3 }

describe('computeSplit', () => {
  it('gives the plan example: 2400x1080 phone at 60/40 asks for 1440x1080', () => {
    const layout = computeSplit({ ...phoneLandscape, monitorFraction: 0.6 })
    expect(layout.orientation).toBe('landscape')
    expect(layout.stream).toEqual({ width: 1440, height: 1080 })
    expect(layout.monitor).toEqual({ x: 0, y: 0, width: 480, height: 360 })
    expect(layout.panel).toEqual({ x: 480, y: 0, width: 320, height: 360 })
  })

  it('puts the monitor on top in portrait', () => {
    const layout = computeSplit({ ...phonePortrait, monitorFraction: SPLIT_PRESETS['50-50'] })
    expect(layout.orientation).toBe('portrait')
    expect(layout.monitor).toEqual({ x: 0, y: 0, width: 360, height: 400 })
    expect(layout.panel).toEqual({ x: 0, y: 400, width: 360, height: 400 })
    expect(layout.stream).toEqual({ width: 1080, height: 1200 })
  })

  it('halves the stream at half quality', () => {
    const layout = computeSplit({ ...phoneLandscape, monitorFraction: 1, quality: 'half' })
    expect(layout.stream).toEqual({ width: 1200, height: 540 })
  })

  it('returns no stream in widgets-only mode', () => {
    const layout = computeSplit({ ...phoneLandscape, monitorFraction: SPLIT_PRESETS.widgets })
    expect(layout.stream).toBeNull()
    expect(layout.panel.width).toBe(800)
  })

  it('holds the divider at the driver minimum', () => {
    // 10% of 2400 px would be 240 px wide; the driver needs 640.
    const layout = computeSplit({ ...phoneLandscape, monitorFraction: 0.1 })
    expect(layout.monitorFraction).toBeCloseTo(640 / 2400)
    expect(layout.stream?.width).toBeGreaterThanOrEqual(MIN_STREAM.width)
  })

  it('clamps a too-small device up to the minimum and reports fraction 1', () => {
    const tiny = { viewport: { width: 300, height: 200 }, devicePixelRatio: 1 }
    expect(minMonitorFraction(tiny)).toBe(1)
    expect(computeSplit({ ...tiny, monitorFraction: 0.5 }).stream).toEqual(MIN_STREAM)
  })

  it('rejects nonsense input instead of producing NaN sizes', () => {
    expect(() =>
      computeSplit({ viewport: { width: 0, height: 10 }, devicePixelRatio: 1, monitorFraction: 1 }),
    ).toThrow(RangeError)
    expect(computeSplit({ ...phoneLandscape, monitorFraction: Number.NaN }).stream).toBeNull()
  })

  it('always tiles the viewport and requests a valid, even resolution', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 3000 }),
        fc.integer({ min: 200, max: 3000 }),
        fc.double({ min: 0.5, max: 4, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom('full' as const, 'half' as const),
        (width, height, devicePixelRatio, monitorFraction, quality) => {
          const layout = computeSplit({
            viewport: { width, height },
            devicePixelRatio,
            monitorFraction,
            quality,
          })
          const { monitor, panel, stream } = layout
          if (layout.orientation === 'landscape') {
            expect(monitor.width + panel.width).toBe(width)
            expect(panel.x).toBe(monitor.width)
          } else {
            expect(monitor.height + panel.height).toBe(height)
            expect(panel.y).toBe(monitor.height)
          }
          if (stream) {
            expect(stream.width % 2).toBe(0)
            expect(stream.height % 2).toBe(0)
            expect(stream.width).toBeGreaterThanOrEqual(MIN_STREAM.width)
            expect(stream.height).toBeGreaterThanOrEqual(MIN_STREAM.height)
            expect(stream.width).toBeLessThanOrEqual(MAX_STREAM.width)
            expect(stream.height).toBeLessThanOrEqual(MAX_STREAM.height)
          }
        },
      ),
    )
  })
})
