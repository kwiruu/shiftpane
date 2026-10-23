import { describe, expect, it } from 'vitest'
import { calendarDate, contributionWeeks, contributionMonth } from './contributions.ts'

const day = (date: string, count = 2, level = 2) => ({ date, count, level })
const data = {
  startDate: '2023-12-31',
  endDate: '2024-03-02',
  days: [day('2024-02-29'), day('2024-03-02', 3)],
}

describe('contribution calendar', () => {
  it('shows only the current month with seven weekday columns and blank future cells', () => {
    const month = contributionMonth({
      startDate: '2026-09-01',
      endDate: '2026-10-23',
      days: [day('2026-09-30'), day('2026-10-01'), day('2026-10-23'), day('2026-10-24')],
    })
    expect(month).toHaveLength(5)
    expect(month[0]?.[4]?.date).toBe('2026-10-01')
    expect(month[3]?.[5]?.date).toBe('2026-10-23')
    expect(month.flat().filter(Boolean)).toHaveLength(2)
    expect(month[4]?.every((d) => d === null)).toBe(true)
    expect(
      contributionMonth({
        startDate: '2024-02-01',
        endDate: '2024-02-29',
        days: [day('2024-02-29')],
      }),
    ).toHaveLength(5)
    expect(
      contributionMonth({
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        days: [day('2026-05-01')],
      }),
    ).toHaveLength(6)
  })
  it('validates leap days and invalid dates', () => {
    expect(calendarDate('2024-02-29')).not.toBeNull()
    expect(calendarDate('2023-02-29')).toBeNull()
    expect(calendarDate('2024-13-01')).toBeNull()
  })
  it('orders Sunday–Saturday across months and leaves missing dates blank', () => {
    const weeks = contributionWeeks(data, 1)
    expect(weeks).toHaveLength(1)
    expect(weeks[0]?.[4]?.date).toBe('2024-02-29')
    expect(weeks[0]?.[6]?.date).toBe('2024-03-02')
    expect(weeks[0]?.[0]).toBeNull()
  })
  it('keeps partial weeks, pads the beginning, and blanks future days', () => {
    const weeks = contributionWeeks(
      { startDate: '2024-02-29', endDate: '2024-03-01', days: data.days },
      8,
    )
    expect(weeks).toHaveLength(1)
    expect(weeks[0]?.[0]).toBeNull()
    expect(weeks[0]?.[6]).toBeNull()
  })
  it('caps history at 54 weeks and computes displayed-period totals', () => {
    const all = {
      startDate: '2022-01-01',
      endDate: '2024-03-02',
      days: [...data.days, day('2023-12-31', 20)],
    }
    expect(contributionWeeks(all, 100)).toHaveLength(54)
    const total = (n: number) =>
      contributionWeeks(all, n)
        .flat()
        .reduce((sum, d) => sum + (d?.count ?? 0), 0)
    expect(total(8)).toBe(5)
    expect(total(26)).toBe(25)
  })
  it('ignores malformed entries and deduplicates dates', () => {
    const weeks = contributionWeeks({
      ...data,
      days: [
        null,
        {},
        day('2024-02-29', -1),
        day('2024-03-01', 2, 5),
        day('2024-03-02', 3),
        day('2024-03-02', 3),
      ],
    })
    expect(weeks.flat().filter(Boolean)).toEqual([day('2024-03-02', 3)])
    expect(contributionWeeks(null)).toEqual([])
    expect(contributionWeeks({ ...data, endDate: 'bad' })).toEqual([])
  })
  it('does not shift dates according to viewer timezone and crosses year boundaries', () => {
    expect(
      contributionWeeks(
        {
          startDate: '2023-12-31',
          endDate: '2024-01-01',
          days: [day('2023-12-31'), day('2024-01-01')],
        },
        1,
      )[0]?.map((d) => d?.date ?? null),
    ).toEqual(['2023-12-31', '2024-01-01', null, null, null, null, null])
  })
})
