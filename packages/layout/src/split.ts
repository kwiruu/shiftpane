/**
 * Split view: part of the phone is the second monitor, the rest is the widget panel.
 *
 * The virtual monitor is created at the size of the monitor area, not the whole phone, so
 * the split the user picks *is* the resolution Windows sees. Example: a 2400x1080 phone in
 * landscape at a 60/40 split asks for a 1440x1080 monitor.
 */

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

/** Smallest and largest monitor the virtual display drivers accept, in physical pixels. */
export const MIN_STREAM: Readonly<Size> = { width: 640, height: 480 }
export const MAX_STREAM: Readonly<Size> = { width: 7680, height: 4320 }

export type Orientation = 'landscape' | 'portrait'
export type Quality = 'full' | 'half'

export const SPLIT_PRESETS = {
  monitor: 1,
  '70-30': 0.7,
  '50-50': 0.5,
  widgets: 0,
} as const satisfies Record<string, number>

export type SplitPreset = keyof typeof SPLIT_PRESETS

export interface SplitInput {
  /** Layout viewport in CSS pixels (`innerWidth` x `innerHeight`). */
  viewport: Size
  devicePixelRatio: number
  /** Share of the long axis given to the monitor, 0 (widgets only) to 1 (monitor only). */
  monitorFraction: number
  /** `half` streams at half the physical pixels; the phone scales the video up. */
  quality?: Quality
}

export interface SplitLayout {
  orientation: Orientation
  /** Where the video goes, in CSS pixels. Left in landscape, top in portrait. */
  monitor: Rect
  /** Where the widget panel goes, in CSS pixels. */
  panel: Rect
  /** Resolution to request from the PC, or null when the monitor area is hidden. */
  stream: Size | null
  /** The fraction actually applied after clamping to the driver's minimum size. */
  monitorFraction: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Largest even integer not above `value`: hardware encoders work on 2x2 blocks. */
const evenFloor = (value: number) => Math.floor(value / 2) * 2

export function orientationOf(viewport: Size): Orientation {
  return viewport.width >= viewport.height ? 'landscape' : 'portrait'
}

/**
 * Smallest monitor fraction that still yields a MIN_STREAM-sized monitor on this device,
 * so the divider cannot be dragged below what the driver accepts. Returns 1 when even the
 * full screen is too small; the stream is then clamped up and letterboxed.
 */
export function minMonitorFraction(input: Omit<SplitInput, 'monitorFraction'>): number {
  const orientation = orientationOf(input.viewport)
  const scale = input.devicePixelRatio * (input.quality === 'half' ? 0.5 : 1)
  const longAxis = orientation === 'landscape' ? input.viewport.width : input.viewport.height
  const minAlongAxis = orientation === 'landscape' ? MIN_STREAM.width : MIN_STREAM.height
  return clamp(minAlongAxis / (longAxis * scale), 0, 1)
}

export function computeSplit(input: SplitInput): SplitLayout {
  const { viewport, devicePixelRatio } = input
  if (!(viewport.width > 0 && viewport.height > 0 && devicePixelRatio > 0)) {
    throw new RangeError('viewport and devicePixelRatio must be positive')
  }
  const orientation = orientationOf(viewport)
  const requested = clamp(Number.isFinite(input.monitorFraction) ? input.monitorFraction : 0, 0, 1)
  // Zero means "widgets only"; anything else is held at or above the driver's minimum.
  const fraction = requested === 0 ? 0 : Math.max(requested, minMonitorFraction(input))

  let monitor: Rect
  let panel: Rect
  if (orientation === 'landscape') {
    const monitorWidth = Math.round(viewport.width * fraction)
    monitor = { x: 0, y: 0, width: monitorWidth, height: viewport.height }
    panel = { x: monitorWidth, y: 0, width: viewport.width - monitorWidth, height: viewport.height }
  } else {
    const monitorHeight = Math.round(viewport.height * fraction)
    monitor = { x: 0, y: 0, width: viewport.width, height: monitorHeight }
    panel = {
      x: 0,
      y: monitorHeight,
      width: viewport.width,
      height: viewport.height - monitorHeight,
    }
  }

  const scale = devicePixelRatio * (input.quality === 'half' ? 0.5 : 1)
  const stream =
    fraction === 0
      ? null
      : {
          width: clamp(evenFloor(monitor.width * scale), MIN_STREAM.width, MAX_STREAM.width),
          height: clamp(evenFloor(monitor.height * scale), MIN_STREAM.height, MAX_STREAM.height),
        }

  return { orientation, monitor, panel, stream, monitorFraction: fraction }
}
