import { Icon, type IconName } from '@shiftpane/ui/icons'
import type { ReactNode } from 'react'

/** Small form controls for the layout editor's panels. */

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-border border-b p-4 last:border-b-0">
      <header className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h3 className="section-label truncate">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <span className="text-ink-soft text-sm">{label}</span>
      {children}
    </div>
  )
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const button =
    'raised grid size-7 place-items-center rounded-md text-ink-soft transition hover:text-ink disabled:opacity-30'
  return (
    <Row label={label}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Less ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className={button}
        >
          <Icon name="minus" className="size-3.5" />
        </button>
        <output className="w-7 text-center font-mono text-sm tabular-nums">{value}</output>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className={button}
        >
          <Icon name="add" className="size-3.5" />
        </button>
      </div>
    </Row>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <label className="block py-1.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="font-mono text-ink-muted text-xs tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-ink-soft"
      />
    </label>
  )
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset
      aria-label={label}
      className="inline-flex gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 font-medium text-xs transition ${
            option.value === value ? 'lifted text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}

/** A small square button with an icon, for list rows; a press on it never drags the row. */
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  tone,
}: {
  label: string
  icon: IconName
  onClick: () => void
  disabled?: boolean
  tone?: 'danger'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`grid size-7 place-items-center rounded-md transition hover:bg-white/[0.06] disabled:opacity-25 disabled:hover:bg-transparent ${
        tone === 'danger' ? 'text-ink-muted hover:text-danger' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon name={icon} className="size-4" />
    </button>
  )
}
