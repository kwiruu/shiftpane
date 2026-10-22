import { fluid, Label, useNow } from './parts.tsx'
import { firstDayOfWeek, monthGrid, weekOf } from './time.ts'
import type { ElementSize } from './useElementSize.ts'

const FIRST_DAY = firstDayOfWeek(navigator.language)

const weekdayInitial = (date: Date) => date.toLocaleDateString([], { weekday: 'narrow' })

/** Today, the week around it, or the whole month, whichever the card has room for. */
export function CalendarWidget({ box }: { box: ElementSize }) {
  const now = useNow('minute')
  const weekday = now.toLocaleDateString([], { weekday: 'long' })
  const month = now.toLocaleDateString([], { month: 'long' })
  const today = now.getDate()

  // Wide and short: today on the left, this week beside it.
  if (box.width >= box.height * 1.7 && box.width >= 240) {
    const week = weekOf(now, FIRST_DAY)
    return (
      <div className="flex h-full items-center justify-between" style={{ gap: fluid(12, 8, 32) }}>
        <div className="flex shrink-0 items-center" style={{ gap: fluid(8, 5, 16) }}>
          <p
            className="font-normal tabular-nums leading-none tracking-tight"
            style={{ fontSize: fluid(36, 38, 92) }}
          >
            {today}
          </p>
          <div>
            <p className="font-semibold leading-tight" style={{ fontSize: fluid(14, 10, 24) }}>
              {weekday}
            </p>
            <Label>{month}</Label>
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-7 text-center" style={{ maxWidth: '26rem' }}>
          {week.map((day) => {
            const isToday = day.toDateString() === now.toDateString()
            return (
              <div key={day.toISOString()} className="grid justify-items-center gap-[2cqmin]">
                <span
                  className={`grid aspect-square w-[min(100%,2.6em)] place-items-center rounded-full font-medium tabular-nums ${
                    isToday ? 'bg-card-accent text-card-accent-ink' : ''
                  }`}
                  style={{ fontSize: fluid(12, 8, 18) }}
                >
                  {day.getDate()}
                </span>
                <span className="text-card-muted" style={{ fontSize: fluid(10, 5.5, 13) }}>
                  {weekdayInitial(day)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Small: just today, big.
  if (Math.min(box.width, box.height) < 150) {
    return (
      <div className="flex h-full flex-col justify-between">
        <p
          className="font-medium text-card-muted uppercase tracking-wide"
          style={{ fontSize: fluid(10, 8, 15) }}
        >
          {weekday}
        </p>
        <div>
          <p
            className="font-normal tabular-nums leading-[0.9] tracking-tight"
            style={{ fontSize: fluid(34, 40, 96) }}
          >
            {today}
          </p>
          <Label>{month}</Label>
        </div>
      </div>
    )
  }

  // Room for the month.
  const weeks = monthGrid(now.getFullYear(), now.getMonth(), FIRST_DAY)
  const header = weekOf(now, FIRST_DAY)
  const weekend = (column: number) => {
    const day = (FIRST_DAY + column) % 7
    return day === 0 || day === 6
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold" style={{ fontSize: fluid(14, 8.5, 22) }}>
          {month}
        </p>
        <p className="font-medium text-card-muted" style={{ fontSize: fluid(11, 6.5, 16) }}>
          {weekday}
        </p>
      </div>
      <div
        className="mt-[3cqmin] grid grid-cols-7 text-center text-card-muted"
        style={{ fontSize: fluid(9, 4.6, 13) }}
      >
        {header.map((day) => (
          <span key={day.toISOString()}>{weekdayInitial(day)}</span>
        ))}
      </div>
      <div
        className="mt-[1.5cqmin] grid min-h-0 flex-1 grid-cols-7 text-center"
        style={{
          gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
          fontSize: fluid(10, 5, 16),
        }}
      >
        {weeks.flatMap((week, row) =>
          week.map((day, column) => (
            <div key={`${row}-${column}`} className="grid min-h-0 place-items-center">
              {day !== null && (
                <span
                  className={`grid aspect-square h-[92%] max-h-[2.4em] place-items-center rounded-full font-medium tabular-nums ${
                    day === today
                      ? 'bg-card-accent text-card-accent-ink'
                      : weekend(column)
                        ? 'text-card-muted'
                        : day < today
                          ? 'text-card-ink/55'
                          : ''
                  }`}
                >
                  {day}
                </span>
              )}
            </div>
          )),
        )}
      </div>
    </div>
  )
}
