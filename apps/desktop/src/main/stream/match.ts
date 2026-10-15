import type { DisplayInfo } from '@shiftpane/helper-client'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What the matcher needs from the helper's `DisplayInfo`: physical pixels, GDI naming. */
export type HelperDisplay = Pick<DisplayInfo, 'id' | 'name' | 'x' | 'y' | 'width' | 'height'>

/** One of Electron's `screen.getAllDisplays()`, with its bounds also in physical pixels. */
export interface ScreenDisplay {
  /** `Display.id`, which is also the `display_id` of its capture source (as a string). */
  id: number
  /** The monitor's friendly name (`Display.label`), e.g. "Mi Monitor". */
  label: string
  /**
   * The display's rectangle in physical pixels: `screen.dipToScreenRect(null, display.bounds)`.
   * Electron's own `bounds` are DIPs, which differ from the helper's pixels whenever the
   * monitor is scaled.
   */
  physicalBounds: Rect
}

/** A `desktopCapturer` screen source. */
export interface ScreenSource {
  /** `screen:<n>:0`, the `chromeMediaSourceId`. */
  id: string
  name: string
  /** `String(Display.id)`; empty when Electron could not say. */
  display_id: string
}

export type DisplayMatch =
  | { ok: true; display: ScreenDisplay; by: 'bounds' | 'label-and-size' }
  | { ok: false; reason: 'no-display' | 'ambiguous' }

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

const sameSize = (a: Rect, b: Rect) => a.width === b.width && a.height === b.height

const sameName = (a: string, b: string) =>
  a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Finds the Electron display that is the helper's virtual monitor.
 *
 * The helper names a monitor by its GDI device name (`\\.\DISPLAY8`), which changes whenever
 * the driver restarts, and Electron's `Display.id` is a different number altogether, so the two
 * cannot be joined on `id`. What both sides agree on is where the monitor is on the desktop:
 * a desktop is laid out once, so a monitor's rectangle in physical pixels is unique.
 *
 * 1. The same rectangle. Two displays can share one only when they are cloned, and then they
 *    show the same picture, so the one whose name also matches is preferred and otherwise the
 *    first is as good as any.
 * 2. The same friendly name and size, for when the rectangle moved between the helper's answer
 *    and Electron's refresh. Used only when exactly one display qualifies, so a real monitor of
 *    the same resolution is never mistaken for the virtual one.
 *
 * Returns a reason instead of guessing: capturing the wrong screen would put the user's real
 * desktop on the phone.
 */
export function matchDisplay(
  target: HelperDisplay,
  displays: readonly ScreenDisplay[],
): DisplayMatch {
  const rect: Rect = { x: target.x, y: target.y, width: target.width, height: target.height }

  const sameBounds = displays.filter((display) => sameRect(display.physicalBounds, rect))
  const [first] = sameBounds
  if (first) {
    const named = sameBounds.find((display) => sameName(display.label, target.name))
    return { ok: true, display: named ?? first, by: 'bounds' }
  }

  const alike = displays.filter(
    (display) => sameName(display.label, target.name) && sameSize(display.physicalBounds, rect),
  )
  const [only] = alike
  if (only && alike.length === 1) return { ok: true, display: only, by: 'label-and-size' }
  return { ok: false, reason: alike.length > 1 ? 'ambiguous' : 'no-display' }
}

export type SourceMatch<Source extends ScreenSource = ScreenSource> =
  | { ok: true; source: Source }
  | { ok: false; reason: 'no-source' | 'no-display-ids' }

/**
 * The capture source of a display. Electron fills `display_id` only after the `screen` module
 * has listed the displays, so when every source has an empty one the caller listed them too
 * late; that is reported apart so the log says so instead of "no such source".
 */
export function matchSource<Source extends ScreenSource>(
  display: Pick<ScreenDisplay, 'id'>,
  sources: readonly Source[],
): SourceMatch<Source> {
  const wanted = String(display.id)
  const source = sources.find((candidate) => candidate.display_id === wanted)
  if (source) return { ok: true, source }
  const anyId = sources.some((candidate) => candidate.display_id !== '')
  return { ok: false, reason: anyId || sources.length === 0 ? 'no-source' : 'no-display-ids' }
}
