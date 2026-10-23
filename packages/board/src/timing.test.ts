import { describe, expect, it } from 'vitest'
import {
  clockValue,
  formatTime,
  initialTime,
  nextPhase,
  reconcileTime,
  restoreTime,
} from './timing.ts'

describe('device timing', () => {
  it('derives elapsed time from timestamps and preserves paused values', () => {
    const s = initialTime()
    s.clocks.timer.startedAt = 1000
    s.clocks.stopwatch.startedAt = 1000
    expect(clockValue(s, 'timer', 11000)).toBe(290000)
    expect(clockValue(s, 'stopwatch', 11000)).toBe(10000)
    s.clocks.timer = { value: 290000, startedAt: null }
    expect(clockValue(s, 'timer', 900000)).toBe(290000)
  })
  it('stops timers at zero independently of focus and stopwatch', () => {
    const s = initialTime()
    s.clocks.timer.startedAt = 0
    s.clocks.stopwatch.startedAt = 0
    const next = reconcileTime(s, 400000)
    expect(next.clocks.timer).toEqual({ value: 0, startedAt: null })
    expect(next.clocks.focus).toEqual(s.clocks.focus)
    expect(clockValue(next, 'stopwatch', 400000)).toBe(400000)
  })
  it('automatically advances at the boundary and takes a long break after four sessions', () => {
    let s = initialTime()
    s.clocks.focus.startedAt = 0
    s = reconcileTime(s, 25 * 60000)
    expect(s.phase).toBe('short')
    expect(s.completed).toBe(1)
    expect(s.clocks.focus.startedAt).toBe(25 * 60000)
    s = reconcileTime(s, 115 * 60000)
    expect(s.phase).toBe('long')
    expect(s.completed).toBe(4)
    s = reconcileTime(s, 130 * 60000)
    expect(s.phase).toBe('focus')
  })
  it('recovers many cycles without losing phase position', () => {
    const s = initialTime()
    s.clocks.focus.startedAt = 0
    const next = reconcileTime(s, (130 * 10000 + 27) * 60000)
    expect(next.phase).toBe('short')
    expect(next.completed).toBe(40001)
    expect(clockValue(next, 'focus', (130 * 10000 + 27) * 60000)).toBe(3 * 60000)
  })
  it('does not count a skipped focus session', () => {
    expect(nextPhase(initialTime(), false).completed).toBe(0)
    expect(nextPhase(initialTime(), false).phase).toBe('short')
    const s = initialTime()
    s.completed = 4
    expect(nextPhase(s, false).phase).toBe('short')
  })
  it('restores valid state and rejects malformed, missing or unsafe storage', () => {
    expect(restoreTime(JSON.stringify(initialTime()))).toEqual(initialTime())
    for (const raw of [
      null,
      '{}',
      'broken',
      JSON.stringify({ ...initialTime(), durations: { focus: 0 } }),
    ]) {
      expect(restoreTime(raw)).toEqual(initialTime())
    }
  })
  it('formats countdowns, hours and stopwatch hundredths', () => {
    expect(formatTime(1)).toBe('00:01')
    expect(formatTime(3600000)).toBe('01:00:00')
    expect(formatTime(12345, true)).toBe('00:12.34')
    expect(formatTime(359999000)).toBe('99:59:59')
  })
})
