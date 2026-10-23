import { type MonitorScale, SCALE_CHOICES } from '../../shared/display.ts'

/**
 * The OS scale to give a phone's monitor, in percent, or undefined to leave the OS's own.
 *
 * Matching the phone uses its device pixel ratio: the phone's own apps draw each CSS pixel that
 * many pixels wide, so at that scale the PC's text comes out the size the phone's is. The OS may
 * cap it for a small monitor; the helper reports the scale it got.
 */
export function monitorScale(setting: MonitorScale, devicePixelRatio: number): number | undefined {
  if (setting === 'os') return undefined
  if (typeof setting === 'number') return setting
  const wanted = devicePixelRatio * 100
  return SCALE_CHOICES.reduce<number>(
    (best, step) => (Math.abs(step - wanted) < Math.abs(best - wanted) ? step : best),
    SCALE_CHOICES[0],
  )
}
