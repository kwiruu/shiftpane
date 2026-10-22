import type { CSSProperties } from 'react'
import { SOLAR } from './solar.tsx'

/**
 * ShiftPane's icons: the Solar set, mostly its Bold Duotone style, where the back of a shape is
 * the same colour at half strength. They take the text colour. Add one in scripts/icons.ts.
 */
export type IconName = keyof typeof SOLAR

export function Icon({
  name,
  className = 'size-5',
  style,
}: {
  name: IconName
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} style={style} aria-hidden>
      {SOLAR[name]}
    </svg>
  )
}
