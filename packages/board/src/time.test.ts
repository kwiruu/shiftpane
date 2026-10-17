import { describe, expect, it } from 'vitest'
import { dayProgress, firstDayOfWeek, isoWeek, monthGrid, timeParts, weekOf } from './time.ts'

describe('isoWeek', () => {
  it('numbers weeks the ISO way, across year ends', () => {
    expect(isoWeek(new Date(2026, 9, 16))).toBe(42)
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1)
    // 1 January 2027 is a Friday, so it still belongs to 2026's last week.
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53)
    expect(isoWeek(new Date(2024, 11, 30))).toBe(1)
  })
})

describe('dayProgress', () => {
  it('runs from 0 at midnight to one half at noon', () => {
    expect(dayProgress(new Date(2026, 9, 16, 0, 0, 0))).toBe(0)
    expect(dayProgress(new Date(2026, 9, 16, 12, 0, 0))).toBe(0.5)
  })
})

describe('monthGrid', () => {
  it('lays out a month in weeks starting on the chosen day', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const monday = monthGrid(2026, 9, 1)
    expect(monday[0]).toEqual([null, null, null, 1, 2, 3, 4])
    expect(monday).toHaveLength(5)
    expect(monday.at(-1)).toEqual([26, 27, 28, 29, 30, 31, null])
    const sunday = monthGrid(2026, 9, 0)
    expect(sunday[0]).toEqual([null, null, null, null, 1, 2, 3])
  })
})

describe('weekOf', () => {
  it('gives the seven days around a date, across a month end', () => {
    const days = weekOf(new Date(2026, 9, 1), 1).map(
      (day) => `${day.getMonth() + 1}/${day.getDate()}`,
    )
    expect(days).toEqual(['9/28', '9/29', '9/30', '10/1', '10/2', '10/3', '10/4'])
  })
})

describe('firstDayOfWeek', () => {
  it('falls back to Monday for a tag it cannot read', () => {
    expect(firstDayOfWeek('not a locale!')).toBe(1)
    expect([0, 1, 6]).toContain(firstDayOfWeek('en-US'))
  })
})

describe('timeParts', () => {
  it('splits AM/PM off the time where the locale uses it', () => {
    const evening = new Date(2026, 9, 16, 22, 5)
    expect(timeParts(evening, 'en-US')).toEqual({ time: '10:05', period: 'PM' })
    expect(timeParts(evening, 'de-DE')).toEqual({ time: '22:05', period: null })
  })
})
