import { fluid, Label, useNow } from './parts.tsx'
import { timeParts } from './time.ts'
import type { ElementSize } from './useElementSize.ts'

const NUMERALS = [
  { text: 'XII', x: 100, y: 34 },
  { text: 'III', x: 166, y: 100 },
  { text: 'VI', x: 100, y: 166 },
  { text: 'IX', x: 34, y: 100 },
] as const

function Face({ now }: { now: Date }) {
  const seconds = now.getSeconds()
  const minutes = now.getMinutes() + seconds / 60
  const hours = (now.getHours() % 12) + minutes / 60
  const hand = (angle: number) => `rotate(${angle} 100 100)`
  return (
    <svg viewBox="0 0 200 200" className="block size-full" aria-hidden>
      <circle cx="100" cy="100" r="98" fill="var(--card-soft)" />
      <text
        x="100"
        y="104"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="92"
        fontWeight="700"
        fill="var(--card-ink)"
        opacity="0.035"
        className="tabular-nums"
      >
        {String(now.getDate()).padStart(2, '0')}
      </text>
      {Array.from({ length: 60 }, (_, i) =>
        i % 15 === 0 ? null : (
          <line
            key={i}
            x1="100"
            y1="9"
            x2="100"
            y2={i % 5 === 0 ? 19 : 14}
            stroke="var(--card-ink)"
            strokeOpacity={i % 5 === 0 ? 0.7 : 0.22}
            strokeWidth={i % 5 === 0 ? 2.4 : 1.4}
            strokeLinecap="round"
            transform={hand(i * 6)}
          />
        ),
      )}
      {NUMERALS.map(({ text, x, y }) => (
        <text
          key={text}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="17"
          fontWeight="500"
          fill="var(--card-ink)"
        >
          {text}
        </text>
      ))}
      <g stroke="var(--card-ink)" strokeLinecap="round">
        <line x1="100" y1="112" x2="100" y2="56" strokeWidth="7" transform={hand(hours * 30)} />
        <line x1="100" y1="114" x2="100" y2="30" strokeWidth="4.5" transform={hand(minutes * 6)} />
      </g>
      <g transform={hand(seconds * 6)}>
        <line
          x1="100"
          y1="124"
          x2="100"
          y2="20"
          stroke="var(--card-muted)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>
      <circle cx="100" cy="100" r="5.5" fill="var(--card-ink)" />
      <circle cx="100" cy="100" r="2.5" fill="var(--card)" />
    </svg>
  )
}

/** A round clock face, with the date beside it when the card is wide enough. */
export function AnalogClockWidget({ box }: { box: ElementSize }) {
  const now = useNow()
  const { time, period } = timeParts(now)
  const label = `${time}${period ? ` ${period}` : ''}`
  const weekday = now.toLocaleDateString([], { weekday: 'long' })
  const date = now.toLocaleDateString([], { month: 'long', day: 'numeric' })

  if (box.width > box.height * 1.45) {
    return (
      <div
        role="img"
        aria-label={label}
        className="flex h-full items-center"
        style={{ gap: fluid(12, 8, 28) }}
      >
        <div className="aspect-square h-full shrink-0">
          <Face now={now} />
        </div>
        <div className="min-w-0">
          <p
            className="truncate font-semibold leading-tight"
            style={{ fontSize: fluid(16, 11, 30) }}
          >
            {weekday}
          </p>
          <Label>{date}</Label>
          <p
            className="mt-[4cqmin] font-semibold tabular-nums leading-none tracking-tight"
            style={{ fontSize: fluid(22, 16, 52) }}
          >
            {time}
            {period && <span className="ml-1 text-[0.45em] text-card-muted">{period}</span>}
          </p>
        </div>
      </div>
    )
  }

  if (box.height > box.width * 1.45) {
    return (
      <div role="img" aria-label={label} className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <Face now={now} />
        </div>
        <p
          className="mt-[5cqmin] truncate text-center font-semibold leading-tight"
          style={{ fontSize: fluid(14, 9, 24) }}
        >
          {weekday}
        </p>
        <Label className="text-center">{date}</Label>
      </div>
    )
  }

  // The SVG keeps its square and centres itself in whatever box it gets.
  return (
    <div role="img" aria-label={label} className="h-full">
      <Face now={now} />
    </div>
  )
}
