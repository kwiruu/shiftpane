import { describe, expect, it } from 'vitest'
import { monitorScale } from './scale.ts'

describe('monitorScale', () => {
  it('matches the phone with the step nearest its device pixel ratio', () => {
    expect(monitorScale('phone', 1)).toBe(100)
    expect(monitorScale('phone', 2)).toBe(200)
    expect(monitorScale('phone', 2.625)).toBe(250)
    // Halfway between two steps keeps the smaller.
    expect(monitorScale('phone', 2.75)).toBe(250)
    expect(monitorScale('phone', 3.5)).toBe(300)
  })

  it('leaves the scale to the OS, or uses the one picked', () => {
    expect(monitorScale('os', 3)).toBeUndefined()
    expect(monitorScale(175, 3)).toBe(175)
  })
})
