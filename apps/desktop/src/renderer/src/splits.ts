import { SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'

export const SPLIT_LABELS: Record<SplitPreset, string> = {
  monitor: 'Monitor only',
  '70-30': '70 / 30',
  '50-50': '50 / 50',
  widgets: 'Widgets only',
}

/** A phone's split as the phone's menu names it, or as two percentages. */
export function splitName(fraction: number): string {
  const preset = (Object.keys(SPLIT_PRESETS) as SplitPreset[]).find(
    (key) => SPLIT_PRESETS[key] === fraction,
  )
  if (preset) return SPLIT_LABELS[preset]
  return `${Math.round(fraction * 100)} / ${Math.round((1 - fraction) * 100)}`
}
