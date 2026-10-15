import { computeSplit, MAX_STREAM, MIN_STREAM, SPLIT_PRESETS } from '@shiftpane/layout'
import { describe, expect, it } from 'vitest'
import { sizesForPhone } from './sizes.ts'

// The helper accepts at most this many sizes per display.prepare (MAX_PREPARE_SIZES in mode.rs).
const HELPER_LIMIT = 16

describe('sizesForPhone', () => {
  it('lists the full-quality size of every streaming preset in both orientations', () => {
    // A 2400x1080 phone (800x360 CSS pixels at 3x), as in the PhoneHub tests.
    const sizes = sizesForPhone({ width: 800, height: 360 }, 3)
    expect(sizes.slice(0, 6)).toEqual([
      { width: 2400, height: 1080 }, // landscape, monitor only
      { width: 1680, height: 1080 }, // landscape, 70/30
      { width: 1200, height: 1080 }, // landscape, 50/50
      { width: 1080, height: 2400 }, // portrait, monitor only
      { width: 1080, height: 1680 },
      { width: 1080, height: 1200 },
    ])
  })

  it('gives the same list whichever way round the phone was held when it paired', () => {
    expect(sizesForPhone({ width: 360, height: 800 }, 3)).toEqual(
      sizesForPhone({ width: 800, height: 360 }, 3),
    )
  })

  it('also covers half quality, which streams at half the physical pixels', () => {
    const sizes = sizesForPhone({ width: 800, height: 360 }, 3)
    expect(sizes).toContainEqual({ width: 1200, height: 540 })
    expect(sizes).toContainEqual({ width: 840, height: 540 })
  })

  it('contains exactly what the phone computes for a landscape preset at that viewport', () => {
    const viewport = { width: 915, height: 412 }
    const wanted = computeSplit({
      viewport,
      devicePixelRatio: 2.625,
      monitorFraction: SPLIT_PRESETS['70-30'],
    }).stream
    expect(wanted).not.toBeNull()
    expect(sizesForPhone(viewport, 2.625)).toContainEqual(wanted)
  })

  it('stays unique, even, in the driver range and within one prepare call', () => {
    const viewports = [
      { viewport: { width: 800, height: 360 }, dpr: 3 },
      { viewport: { width: 412, height: 915 }, dpr: 2.625 },
      { viewport: { width: 1280, height: 800 }, dpr: 2 },
      { viewport: { width: 1024, height: 768 }, dpr: 1 },
      // Tiny: several sizes clamp to the driver's minimum and collapse into one.
      { viewport: { width: 320, height: 240 }, dpr: 1 },
      // Huge: clamps to the maximum.
      { viewport: { width: 4000, height: 2500 }, dpr: 4 },
    ]
    for (const { viewport, dpr } of viewports) {
      const sizes = sizesForPhone(viewport, dpr)
      const keys = sizes.map((s) => `${s.width}x${s.height}`)
      expect(new Set(keys).size, keys.join()).toBe(keys.length)
      expect(sizes.length).toBeGreaterThan(0)
      expect(sizes.length).toBeLessThanOrEqual(HELPER_LIMIT)
      for (const { width, height } of sizes) {
        expect(width % 2).toBe(0)
        expect(height % 2).toBe(0)
        expect(width).toBeGreaterThanOrEqual(MIN_STREAM.width)
        expect(height).toBeGreaterThanOrEqual(MIN_STREAM.height)
        expect(width).toBeLessThanOrEqual(MAX_STREAM.width)
        expect(height).toBeLessThanOrEqual(MAX_STREAM.height)
      }
    }
  })

  it('returns nothing for a viewport it cannot lay out', () => {
    expect(sizesForPhone({ width: 0, height: 0 }, 2)).toEqual([])
    expect(sizesForPhone({ width: 800, height: 360 }, 0)).toEqual([])
  })
})
