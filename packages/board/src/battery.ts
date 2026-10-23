/** Normalize OS battery data without turning missing readings into an empty battery. */
export function batteryState(data: unknown) {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const percent =
    typeof raw.percent === 'number' && Number.isFinite(raw.percent)
      ? Math.min(100, Math.max(0, raw.percent))
      : null
  const charging = percent !== null && raw.charging === true
  const minutes =
    typeof raw.minutesLeft === 'number' && Number.isFinite(raw.minutesLeft) && raw.minutesLeft >= 0
      ? Math.round(raw.minutesLeft)
      : null
  let caption = ''
  if (percent === null) caption = 'Battery unavailable'
  else if (percent === 100) caption = 'Fully charged'
  else if (charging) caption = 'Charging'
  else if (minutes !== null) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    caption = hours
      ? `~ ${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} min` : ''}`
      : `~ ${minutes} min`
  }
  return {
    percent,
    charging,
    caption,
    segments: Array.from({ length: 5 }, (_, i) =>
      Math.min(1, Math.max(0, (percent ?? 0) / 20 - i)),
    ),
  }
}
