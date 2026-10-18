import { Icon, type IconName } from '@shiftpane/ui/icons'
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/**
 * A card, the building block of every page: a frame of fine diagonal lines with the title in
 * it, around a darker inner panel that holds the content.
 */
export function Card({
  title,
  icon,
  aside,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title?: string
  icon?: IconName
  /** Goes at the right end of the title, like a count or a button. */
  aside?: ReactNode
  children: ReactNode
  className?: string
  /** Replaces the inner panel's padding. */
  bodyClassName?: string
}) {
  return (
    <section
      className={`hatched flex min-h-0 flex-col rounded-panel border border-border bg-surface p-1.5 ${className}`}
    >
      {(title || aside) && (
        <header className="flex min-h-10 shrink-0 items-center gap-2 py-1 pr-1 pl-2.5">
          {icon && <Icon name={icon} className="size-[1.125rem] text-ink-muted" />}
          {title && <h2 className="min-w-12 truncate font-medium text-sm">{title}</h2>}
          {aside && (
            <div className="ml-auto flex min-w-0 items-center justify-end gap-2">{aside}</div>
          )}
        </header>
      )}
      <div
        className={`flex min-h-0 flex-1 flex-col rounded-inner border border-border bg-surface-sunken ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  )
}

type Tone = 'raised' | 'primary' | 'ghost' | 'danger'

const TONES: Record<Tone, string> = {
  raised: 'raised text-ink-soft hover:text-ink hover:brightness-125',
  primary:
    'bg-ink text-surface-sunken shadow-[inset_0_-1px_0_rgb(0_0_0/0.25),0_1px_2px_rgb(0_0_0/0.5)] hover:bg-white',
  ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
  danger: 'raised text-danger hover:brightness-125',
}

/** A button: raised by default, solid light for the main action on a card. */
export function Button({
  tone = 'raised',
  icon,
  size = 'sm',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone
  icon?: IconName
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ink/50 disabled:pointer-events-none disabled:opacity-40 ${
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm'
      } ${TONES[tone]} ${className}`}
    >
      {icon && <Icon name={icon} className={size === 'sm' ? 'size-4' : 'size-[1.125rem]'} />}
      {children}
    </button>
  )
}

/** A small count or tag in the mono face, like "2 / 4". */
export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-md border border-border bg-surface-raised px-2 font-mono text-[11px] text-ink-soft tabular-nums ${className}`}
    >
      {children}
    </span>
  )
}

const DOTS = {
  ok: 'bg-ok shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-ok)_22%,transparent)]',
  warn: 'bg-warn shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-warn)_22%,transparent)]',
  busy: 'animate-pulse bg-warn',
  off: 'bg-ink-faint',
} as const

export type DotTone = keyof typeof DOTS

/** A status light: green when all is well, amber when something needs a look. */
export function Dot({ tone, className = '' }: { tone: DotTone; className?: string }) {
  return (
    <span aria-hidden className={`block size-2 shrink-0 rounded-full ${DOTS[tone]} ${className}`} />
  )
}

/** A native select dressed as a raised button, with an icon in front and a chevron after. */
export function Select({
  icon,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: IconName }) {
  return (
    <span
      className={`raised relative inline-flex h-8 min-w-0 items-center rounded-lg text-ink-soft transition hover:text-ink ${className}`}
    >
      {icon && (
        <Icon name={icon} className="pointer-events-none absolute left-2.5 size-4 text-ink-muted" />
      )}
      <select
        {...props}
        className={`h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg bg-transparent pr-8 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ink/50 [&>option]:bg-surface-raised ${
          icon ? 'pl-8' : 'pl-3'
        }`}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        className="pointer-events-none absolute right-2.5 size-3.5 text-ink-muted"
      />
    </span>
  )
}

/** A big, dim icon at the side of a card, like a picture of what the card is about. */
export function Glyph({ icon }: { icon: IconName }) {
  return (
    <span className="grid size-16 shrink-0 place-items-center rounded-2xl border border-border bg-surface text-ink-faint shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      <Icon name={icon} className="size-9" />
    </span>
  )
}
