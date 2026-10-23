import { afterEach, describe, expect, it } from 'vitest'
import { localTarget } from '../../renderer/src/installed/datetime.ts'

const originalTimezone = process.env.TZ
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimezone
})

describe('countdown target picker', () => {
  it('uses midnight for a date without a time and accepts leap dates', () => {
    process.env.TZ = 'Asia/Manila'
    expect(localTarget('2028-02-29', '')).toEqual({ value: '2028-02-29T00:00:00+08:00' })
    expect(localTarget('2026-02-29', '').problem).toBeTruthy()
  })
  it('rejects daylight-saving gaps and chooses the earlier repeated occurrence', () => {
    process.env.TZ = 'America/New_York'
    expect(localTarget('2026-03-08', '02:30').problem).toBeTruthy()
    expect(localTarget('2026-11-01', '01:30').value).toBe('2026-11-01T01:30:00-04:00')
  })
  it('preserves a saved instant after the PC changes timezone', () => {
    process.env.TZ = 'Asia/Manila'
    const value = localTarget('2026-11-05', '09:00').value ?? ''
    const instant = Date.parse(value)
    process.env.TZ = 'America/New_York'
    expect(Date.parse(value)).toBe(instant)
    expect(new Date(value).toISOString()).toBe('2026-11-05T01:00:00.000Z')
  })
})
