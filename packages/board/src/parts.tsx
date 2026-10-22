import { Icon, type IconName } from '@shiftpane/ui/icons'
import { type CSSProperties, type ReactNode, useEffect, useId, useState } from 'react'

/**
 * Pieces the widgets share: the built-in ones and the ones drawn from a view.json. Every widget
 * card is a size container, so `cqmin` (a percent of the card's shorter side) scales type and
 * spacing with the card; `fluid` keeps it readable.
 */

/**
 * A length that scales with the card, clamped between `min` and `max` CSS pixels. The minimum
 * suits a real phone card; a picture of a phone, with cards a fraction of that size, sets
 * `--fmin: 0` around its board so everything shrinks in proportion instead.
 */
export const fluid = (min: number, cqmin: number, max: number) =>
  `clamp(calc(${min}px * var(--fmin, 1)), ${cqmin}cqmin, ${max}px)`

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

/**
 * A row of rounded blocks filling up from the left, like a battery meter. Each block fills from
 * the bottom (`up`, for tall blocks) or from the left (`across`, for a short strip).
 */
export function Meter({
  percent,
  segments = 5,
  fill: direction = 'up',
  radius = fluid(6, 4, 14),
}: {
  percent: number
  segments?: number
  fill?: 'up' | 'across'
  radius?: string
}) {
  const filled = (clampPercent(percent) / 100) * segments
  return (
    <div className="flex h-full w-full items-end" style={{ gap: fluid(4, 2.6, 10) }}>
      {Array.from({ length: segments }, (_, i) => {
        const fill = Math.min(1, Math.max(0, filled - i))
        return (
          <div
            key={i}
            className="relative h-full flex-1 overflow-hidden bg-card-soft"
            style={{ borderRadius: radius }}
          >
            <div
              className={`absolute bg-card-accent duration-700 ease-out ${
                direction === 'up'
                  ? 'inset-x-0 bottom-0 transition-[height]'
                  : 'inset-y-0 left-0 transition-[width]'
              }`}
              style={{
                [direction === 'up' ? 'height' : 'width']: `${fill * 100}%`,
                borderRadius: radius,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** A filled bar, striped where it is used and hatched where it is not, like memory in use. */
export function Bar({
  percent,
  color = 'var(--card-accent)',
  height,
  radius,
}: {
  percent: number
  color?: string
  height: string
  radius: string
}) {
  return (
    <div
      className="flex w-full shrink-0 overflow-hidden bg-card-soft"
      style={{ height, borderRadius: radius }}
      aria-hidden
    >
      <div
        className="h-full transition-[width] duration-700 ease-out"
        style={{
          width: `${clampPercent(percent)}%`,
          backgroundColor: color,
          backgroundImage:
            'repeating-linear-gradient(-45deg, color-mix(in oklch, var(--card) 22%, transparent) 0 3px, transparent 3px 8px)',
        }}
      />
      <div
        className="h-full flex-1"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, var(--card-line) 0 2px, transparent 2px 7px)',
        }}
      />
    </div>
  )
}

/**
 * Recent values as thin vertical bars, newest on the right in the highlight. A handful of values
 * stay slim bars spread across the width rather than swelling into blobs.
 */
export function HistoryBars({ values, max = 100 }: { values: (number | null)[]; max?: number }) {
  const few = values.length < 24
  return (
    <div
      className={`flex h-full w-full items-center ${few ? 'justify-between' : ''}`}
      style={{ gap: fluid(2, 1.1, 4) }}
      aria-hidden
    >
      {values.map((value, i) => {
        const height = value === null ? 0 : Math.max(6, Math.min(100, (value / max) * 100))
        const last = i === values.length - 1
        return (
          <span
            key={i}
            className={`min-w-px flex-1 rounded-full ${last ? 'bg-card-accent' : 'bg-card-dim'}`}
            style={{ height: `${height}%`, maxWidth: few ? fluid(3, 2, 8) : undefined }}
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

/** Two hues picked from a title, so each track gets its own cover. */
function hues(text: string): [number, number] {
  let hash = 0
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  const first = hash % 360
  return [first, (first + 40 + ((hash >> 9) % 80)) % 360]
}

/** The PC does not send cover art, so a cover is a gradient from the title with an icon on it. */
export function Cover({
  title,
  size,
  icon = 'music',
}: {
  title: string
  size: string
  icon?: string
}) {
  const [a, b] = hues(title)
  return (
    <div
      className="grid shrink-0 place-items-center text-white/85 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
      style={{
        width: size,
        height: size,
        borderRadius: `calc(${size} * 0.24)`,
        background: `linear-gradient(140deg, oklch(0.74 0.16 ${a}), oklch(0.5 0.19 ${b}))`,
      }}
    >
      <WidgetIcon name={icon} className="size-[42%]" />
    </div>
  )
}

/** Three small bars bouncing, while music plays. */
export function Equalizer({ className = 'h-[0.9em]' }: { className?: string }) {
  return (
    <span className={`equalizer inline-flex shrink-0 items-end gap-[2px] ${className}`} aria-hidden>
      <span className="h-full w-[3px] rounded-full bg-mint" />
      <span className="h-full w-[3px] rounded-full bg-mint" />
      <span className="h-full w-[3px] rounded-full bg-mint" />
    </span>
  )
}

/**
 * The icon names a widget's view.json can use (`widgetIcons` in @shiftpane/widget-sdk), drawn from
 * the app's own icon set. A name it doesn't know draws a dot rather than failing.
 */
const WIDGET_ICONS: Record<string, IconName> = {
  activity: 'activity',
  bolt: 'bolt',
  coffee: 'coffee',
  cpu: 'cpu',
  down: 'down',
  gauge: 'gauge',
  memory: 'memory',
  music: 'music',
  network: 'network',
  pause: 'pause',
  play: 'play',
  'skip-back': 'previous',
  'skip-forward': 'next',
  star: 'star',
  thermometer: 'thermometer',
  up: 'up',
}

export function WidgetIcon({
  name,
  className,
  style,
}: {
  name: string
  className?: string
  style?: CSSProperties
}) {
  const icon = Object.hasOwn(WIDGET_ICONS, name) ? WIDGET_ICONS[name] : undefined
  if (!icon) {
    return (
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center ${className ?? ''}`}
        style={style}
      >
        <span className="size-[30%] rounded-full bg-current" />
      </span>
    )
  }
  return <Icon name={icon} className={className} style={style} />
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
