import { type CSSProperties, type ReactNode, useEffect, useId, useState } from 'react'

/**
 * Pieces the widgets share. Every widget card is a size container, so `cqmin` (a percent of
 * the card's shorter side) scales type and spacing with the card; `fluid` keeps it readable.
 */

/** A length that scales with the card, clamped between `min` and `max` CSS pixels. */
export const fluid = (min: number, cqmin: number, max: number) =>
  `clamp(${min}px, ${cqmin}cqmin, ${max}px)`

/** The current time, updated on each new second (or minute). */
export function useNow(every: 'second' | 'minute' = 'second'): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const until = () => {
      const date = new Date()
      return every === 'second'
        ? 1000 - date.getMilliseconds()
        : 60_000 - date.getSeconds() * 1000 - date.getMilliseconds()
    }
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, until())
    }
    timer = setTimeout(tick, until())
    return () => clearTimeout(timer)
  }, [every])
  return now
}

/** Small muted caption above or below a value. */
export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`truncate text-card-muted ${className}`} style={{ fontSize: fluid(11, 6.4, 15) }}>
      {children}
    </p>
  )
}

/** A big number with a small unit after it, like "2.8km". */
export function Value({
  value,
  unit,
  size,
  className = '',
}: {
  value: ReactNode
  unit?: string
  size: string
  className?: string
}) {
  return (
    <p
      className={`whitespace-nowrap font-normal leading-none tracking-tight tabular-nums ${className}`}
      style={{ fontSize: size }}
    >
      {value}
      {unit && (
        <span className="ml-[0.08em] font-normal text-[0.45em] text-card-muted tracking-normal">
          {unit}
        </span>
      )}
    </p>
  )
}

/** A circular gauge with whatever goes in its middle. */
export function Ring({
  percent,
  size,
  thickness = 9,
  color = 'var(--card-accent)',
  children,
}: {
  percent: number
  size: string
  /** Stroke width in a 100-unit box. */
  thickness?: number
  color?: string
  children?: ReactNode
}) {
  const r = 50 - thickness / 2
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--card-soft)"
          strokeWidth={thickness}
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clampPercent(percent)} 100`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="relative text-center leading-none">{children}</div>
    </div>
  )
}

/** A row of rounded blocks filling up from the left, like a battery meter. */
export function Meter({ percent, segments = 5 }: { percent: number; segments?: number }) {
  const filled = (clampPercent(percent) / 100) * segments
  return (
    <div className="flex h-full items-end" style={{ gap: fluid(4, 2.6, 10) }}>
      {Array.from({ length: segments }, (_, i) => {
        const fill = Math.min(1, Math.max(0, filled - i))
        return (
          <div
            key={i}
            className="relative h-full flex-1 overflow-hidden bg-card-soft"
            style={{ borderRadius: fluid(6, 4, 14) }}
          >
            <div
              className="absolute inset-x-0 bottom-0 bg-card-accent transition-[height] duration-700 ease-out"
              style={{ height: `${fill * 100}%`, borderRadius: fluid(6, 4, 14) }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Recent values as thin vertical bars, newest on the right in the highlight. */
export function HistoryBars({ values, max = 100 }: { values: (number | null)[]; max?: number }) {
  return (
    <div className="flex h-full w-full items-center" style={{ gap: fluid(2, 1.1, 4) }} aria-hidden>
      {values.map((value, i) => {
        const height = value === null ? 0 : Math.max(6, Math.min(100, (value / max) * 100))
        const last = i === values.length - 1
        return (
          <span
            key={i}
            className={`min-w-px flex-1 rounded-full ${last ? 'bg-card-accent' : 'bg-card-dim'}`}
            style={{ height: `${height}%` }}
          />
        )
      })}
    </div>
  )
}

/** One or two lines of recent values; the first gets a soft fill under it. */
export function Sparkline({ series }: { series: { values: (number | null)[]; color: string }[] }) {
  const id = useId()
  const all = series.flatMap((line) => line.values).filter((v): v is number => v !== null)
  const top = Math.max(1, ...all) * 1.15
  const length = Math.max(2, ...series.map((line) => line.values.length))
  const points = (values: (number | null)[]) =>
    values.map((value, i) => `${(i / (length - 1)) * 100},${100 - ((value ?? 0) / top) * 100}`)
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="size-full overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={series[0]?.color} stopOpacity="0.35" />
          <stop offset="1" stopColor={series[0]?.color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {series[0] && series[0].values.length > 1 && (
        <path
          d={`M0,100 L${points(series[0].values).join(' L')} L${((series[0].values.length - 1) / (length - 1)) * 100},100 Z`}
          fill={`url(#${id})`}
        />
      )}
      {series.map(
        (line) =>
          line.values.length > 1 && (
            <polyline
              key={line.color}
              points={points(line.values).join(' ')}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ),
      )}
    </svg>
  )
}

/** A soft light behind a dark card's content, as if the card were lit from one corner. */
export function Glow({
  style,
  color = 'var(--card-ink)',
}: {
  style: CSSProperties
  color?: string
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute size-[75%] rounded-full opacity-[0.07] blur-3xl"
      style={{ background: color, ...style }}
    />
  )
}

/** Shown while a PC widget has no data yet. */
export function Waiting({ label = 'Waiting for the PC' }: { label?: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <span className="mx-auto mb-2 block size-2 animate-pulse rounded-full bg-card-muted" />
        <p className="text-card-muted" style={{ fontSize: fluid(11, 6, 14) }}>
          {label}
        </p>
      </div>
    </div>
  )
}

export const clampPercent = (percent: number) => Math.min(100, Math.max(0, percent))
