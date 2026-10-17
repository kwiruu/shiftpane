import { computeSplit, type Rect, type Size, type SplitLayout } from '@shiftpane/layout'
import type { Insets } from '@shiftpane/protocol'

export interface ScreenLayout {
  /** What is left of the screen once the crop is taken off its edges. */
  area: Rect
  /** The split inside `area`, in the whole screen's coordinates. */
  split: SplitLayout
}

/**
 * The phone's screen laid out: the crop taken off its edges (say, for the camera), then the
 * monitor and the widgets split inside what is left, as one. The phone lays itself out with
 * this and the desktop editor previews it with the same numbers. Null when nothing is left.
 */
export function screenLayout(
  screen: Size,
  devicePixelRatio: number,
  monitorFraction: number,
  crop: Insets,
): ScreenLayout | null {
  const area = {
    x: crop.left,
    y: crop.top,
    width: screen.width - crop.left - crop.right,
    height: screen.height - crop.top - crop.bottom,
  }
  if (!(area.width > 0 && area.height > 0 && devicePixelRatio > 0)) return null
  const split = computeSplit({
    viewport: { width: area.width, height: area.height },
    devicePixelRatio,
    monitorFraction,
  })
  const shift = (rect: Rect): Rect => ({ ...rect, x: rect.x + area.x, y: rect.y + area.y })
  return { area, split: { ...split, monitor: shift(split.monitor), panel: shift(split.panel) } }
}
