import { SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'

export const SPLIT_LABELS: Record<SplitPreset, string> = {
  monitor: 'Monitor only',
  '70-30': '70 / 30',
  '50-50': '50 / 50',
  widgets: 'Widgets only',
}

/** The split a share of the screen is, or null when it is none of the phone's splits. */
export function presetOf(fraction: number): SplitPreset | null {
  return (
    (Object.keys(SPLIT_PRESETS) as SplitPreset[]).find((key) => SPLIT_PRESETS[key] === fraction) ??
    null
  )
}

/** A phone's split as the phone's menu names it, or as two percentages. */
export function splitName(fraction: number): string {
  const preset = presetOf(fraction)
  if (preset) return SPLIT_LABELS[preset]
  return `${Math.round(fraction * 100)} / ${Math.round((1 - fraction) * 100)}`
}
