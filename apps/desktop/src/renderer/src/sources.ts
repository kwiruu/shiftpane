import type { MonitorInfo, MonitorSource } from '@shiftpane/protocol'

/** The virtual monitor ShiftPane adds to the PC, which is what a phone shows unless told otherwise. */
export const VIRTUAL: MonitorSource = { kind: 'virtual' }

export const sameSource = (a: MonitorSource, b: MonitorSource): boolean =>
  a.kind === b.kind &&
  (a.kind === 'virtual' || (b.kind === 'mirror' && a.displayId === b.displayId))

/**
 * A source as one `<option>`'s value. A `<select>` only carries strings, so the kind and the
 * monitor's id travel as one: "virtual", or "mirror:2528732444".
 */
export const sourceValue = (source: MonitorSource): string =>
  source.kind === 'virtual' ? 'virtual' : `mirror:${source.displayId}`

/** Reads back what `sourceValue` wrote; null for anything else. */
export function sourceOfValue(value: string): MonitorSource | null {
  if (value === 'virtual') return VIRTUAL
  const displayId = value.startsWith('mirror:') ? value.slice('mirror:'.length) : ''
  return displayId === '' ? null : { kind: 'mirror', displayId }
}

/**
 * What to call a monitor in the picker. The phone's own menu says "Duplicate <name>", which a
 * picker already labelled Show does not need: there it reads as "Show: Mi Monitor".
 */
export const monitorLabel = (monitor: MonitorInfo, index: number): string =>
  monitor.name || `Display ${index + 1}`
