import { MAX_STREAM, MIN_STREAM, MONITOR_SIZES } from '@shiftpane/layout'
import { describe, expect, it } from 'vitest'
import { catalogueSizes } from './sizes.ts'

// The helper accepts at most this many sizes per display.prepare (MAX_PREPARE_SIZES in mode.rs).
const HELPER_LIMIT = 16

describe('catalogueSizes', () => {
  it('is the layout catalogue', () => {
    expect(catalogueSizes()).toEqual(MONITOR_SIZES.map(({ width, height }) => ({ width, height })))
  })

  it('is unique, even, in the driver range and within one prepare call', () => {
    const sizes = catalogueSizes()
    const keys = sizes.map((s) => `${s.width}x${s.height}`)
    expect(new Set(keys).size).toBe(keys.length)
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
  })

  it('returns a fresh list each time, so callers cannot change the catalogue', () => {
    const first = catalogueSizes()
    first.pop()
    expect(catalogueSizes()).toHaveLength(MONITOR_SIZES.length)
  })
})
