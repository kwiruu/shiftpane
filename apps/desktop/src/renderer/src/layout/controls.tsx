import { Icon } from '@shiftpane/board'
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
    <section className="border-border border-b px-4 py-4 last:border-b-0">
      <header className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h3 className="truncate font-medium text-ink-muted text-xs uppercase tracking-wider">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
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
    'grid size-7 place-items-center rounded-md border border-border transition hover:border-accent disabled:opacity-30 disabled:hover:border-border'
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
        <output className="w-7 text-center font-semibold text-sm tabular-nums">{value}</output>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className={button}
        >
          <Icon name="plus" className="size-3.5" />
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
        <span>{label}</span>
        <span className="text-ink-muted text-xs tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-accent"
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
    <fieldset aria-label={label} className="inline-flex rounded-lg bg-surface-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 font-medium text-xs transition ${
            option.value === value ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted'
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}

/** A small square button with an icon, for list rows. */
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  tone,
}: {
  label: string
  icon: Parameters<typeof Icon>[0]['name']
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
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`grid size-7 place-items-center rounded-md transition hover:bg-surface-sunken disabled:opacity-25 disabled:hover:bg-transparent ${
        tone === 'danger' ? 'text-danger' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon name={icon} className="size-4" />
    </button>
  )
}
