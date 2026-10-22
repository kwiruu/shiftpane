import { fluid, Label, useNow } from './parts.tsx'
import { dayProgress, isoWeek, timeParts } from './time.ts'
import type { ElementSize } from './useElementSize.ts'

/** A thin line for the day, filled up to now. */
function DayTrack({ progress }: { progress: number }) {
  const at = `${progress * 100}%`
  return (
    <div className="relative h-[3px] rounded-full bg-card-line" aria-hidden>
      <span className="absolute top-1/2 left-0 size-[7px] -translate-y-1/2 rounded-full bg-card-accent" />
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-card-accent"
        style={{ width: at }}
      />
      <span
        className="absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-card bg-card-accent"
        style={{ left: at }}
      />
    </div>
  )
}

/** The phone's own clock: big time, the date, and how much of the day has gone. */
export function ClockWidget({ box }: { box: ElementSize }) {
  const now = useNow()
  const { time, period } = timeParts(now)
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const weekday = now.toLocaleDateString([], { weekday: 'long' })
  const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' })

  if (box.height < 96 || box.width < 110) {
    return (
      <div className="flex h-full flex-col justify-center">
        <p
          className="font-normal tabular-nums leading-none tracking-tight"
          style={{ fontSize: fluid(22, 30, 56) }}
        >
          {time}
        </p>
        <Label className="mt-1">
          {now.toLocaleDateString([], { weekday: 'short' })} {date}
        </Label>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <p className="truncate font-medium leading-tight" style={{ fontSize: fluid(13, 7.5, 20) }}>
          {weekday}
        </p>
        <Label>
          {date} · Week {isoWeek(now)}
        </Label>
      </div>
      {box.height >= 150 && <DayTrack progress={dayProgress(now)} />}
      <div>
        {period && (
          <p
            className="font-medium text-card-muted leading-none"
            style={{ fontSize: fluid(11, 6, 16) }}
          >
            {period}
          </p>
        )}
        <div className="mt-[1.5cqmin] flex items-end justify-between gap-2">
          <p
            className="font-normal tabular-nums leading-[0.85] tracking-tight"
            style={{ fontSize: fluid(28, box.width > box.height * 1.6 ? 34 : 24, 104) }}
          >
            {time}
          </p>
          {box.width >= 150 && (
            <span
              className="mb-[0.15em] rounded-full bg-card-soft px-[0.6em] py-[0.2em] font-medium text-card-muted tabular-nums shadow-[inset_0_0_0_1px_var(--card-line)]"
              style={{ fontSize: fluid(10, 5.5, 15) }}
            >
              :{seconds}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
