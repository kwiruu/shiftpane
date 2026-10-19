/** Date arithmetic for the clock and calendar widgets, all in the phone's local time. */

const DAY_MS = 24 * 60 * 60 * 1000

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: Date): number {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = (day.getDay() + 6) % 7
  day.setDate(day.getDate() - weekday + 3)
  const firstThursday = new Date(day.getFullYear(), 0, 4)
  const firstWeekday = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstWeekday + 3)
  return 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
}

/** How far through its day `date` is, 0 at midnight to just under 1. */
export function dayProgress(date: Date): number {
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
  return seconds / 86_400
}

/**
 * The weeks of a month for a calendar grid: rows of seven day numbers, with null before the
 * first and after the last day. `firstDay` is the weekday a row starts on (0 Sunday, 1 Monday).
 */
export function monthGrid(year: number, month: number, firstDay: number): (number | null)[][] {
  const lead = (new Date(year, month, 1).getDay() - firstDay + 7) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** The seven days of the week holding `date`, starting on `firstDay`. */
export function weekOf(date: Date, firstDay: number): Date[] {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() - firstDay + 7) % 7))
  return Array.from(
    { length: 7 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  )
}

type WeekInfoLocale = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number }
  weekInfo?: { firstDay: number }
}

/** The weekday this locale's weeks start on (0 Sunday, 1 Monday); Monday when unknown. */
export function firstDayOfWeek(language: string): number {
  try {
    const locale = new Intl.Locale(language) as WeekInfoLocale
    const info = locale.getWeekInfo?.() ?? locale.weekInfo
    // Intl counts 1 (Monday) to 7 (Sunday).
    if (info) return info.firstDay % 7
  } catch {
    // An unparsable language tag: fall through to the default.
  }
  return 1
}

/** Hour and minute as the locale writes them, and AM/PM separately when the locale uses it. */
export function timeParts(date: Date, locale?: string): { time: string; period: string | null } {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(date)
  const period = parts.find((part) => part.type === 'dayPeriod')?.value ?? null
  const time = parts
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim()
  return { time, period }
}
