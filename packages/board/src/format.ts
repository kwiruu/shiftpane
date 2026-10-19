/** Short human units for the PC stats widget. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 1536 -> { value: "1.5", unit: "KB" }, for a big number with a small unit beside it. */
export function bytesParts(bytes: number): { value: string; unit: string } {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return { value: value.toFixed(digits), unit: UNITS[unit] ?? 'B' }
}

/** 1536 -> "1.5 KB"; one decimal below 10 of a unit, none above. */
export function formatBytes(bytes: number): string {
  const { value, unit } = bytesParts(bytes)
  return `${value} ${unit}`
}

export function rateParts(bytesPerSecond: number): { value: string; unit: string } {
  const { value, unit } = bytesParts(bytesPerSecond)
  return { value, unit: `${unit}/s` }
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatPercent(percent: number): string {
  return `${Math.round(Math.min(100, Math.max(0, percent)))}%`
}
