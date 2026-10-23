export interface ContributionDay {
  date: string
  count: number
  level: number
}

const DAY = 86_400_000
const dateAt = (time: number) => new Date(time).toISOString().slice(0, 10)

/** A conventional month grid: seven weekday columns and four to six week rows. */
export function contributionMonth(input: unknown) {
  if (!input || typeof input !== 'object') return []
  const data = input as { endDate?: unknown }
  const end = calendarDate(data.endDate)
  if (end === null) return []
  const date = new Date(end)
  const startDate = `${String(data.endDate).slice(0, 7)}-01`
  const weeks = contributionWeeks({ ...input, startDate }, 6)
  if (!weeks.length) return []
  const firstWeekday = new Date(`${startDate}T00:00:00Z`).getUTCDay()
  const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  const rows = Math.ceil((firstWeekday + days) / 7)
  while (weeks.length < rows) weeks.push(Array.from({ length: 7 }, () => null))
  return weeks
}

/** Validate real ISO calendar dates, without interpreting them in the viewer's timezone. */
export function calendarDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && dateAt(time) === value ? time : null
}

/** Bounds work independently of input size. Missing or malformed days stay blank. */
export function contributionWeeks(input: unknown, limit = 54) {
  if (!input || typeof input !== 'object') return []
  const data = input as { startDate?: unknown; endDate?: unknown; days?: unknown }
  const end = calendarDate(data.endDate)
  const start = calendarDate(data.startDate)
  if (end === null || start === null || start > end || !Array.isArray(data.days)) return []
  const weeks = Math.min(54, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 54))
  const lastSunday = end - new Date(end).getUTCDay() * DAY
  const firstSunday = Math.max(
    lastSunday - (weeks - 1) * 7 * DAY,
    start - new Date(start).getUTCDay() * DAY,
  )
  const byDate = new Map<string, ContributionDay>()
  for (const raw of data.days.slice(0, 378)) {
    if (!raw || typeof raw !== 'object') continue
    const day = raw as ContributionDay
    const time = calendarDate(day.date)
    if (
      time === null ||
      time < start ||
      time > end ||
      time < firstSunday ||
      !Number.isSafeInteger(day.count) ||
      day.count < 0 ||
      !Number.isInteger(day.level) ||
      day.level < 0 ||
      day.level > 4
    )
      continue
    // A duplicate must not inflate the displayed total.
    byDate.set(day.date, { date: day.date, count: day.count, level: day.level })
  }
  const result: (ContributionDay | null)[][] = []
  for (let sunday = firstSunday; sunday <= lastSunday; sunday += 7 * DAY) {
    result.push(Array.from({ length: 7 }, (_, i) => byDate.get(dateAt(sunday + i * DAY)) ?? null))
  }
  return result
}
