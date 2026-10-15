/**
 * The fixed set of monitor sizes ShiftPane ever asks the virtual display driver for.
 *
 * The monitor is not resized to each phone's split. Every split is matched to the nearest size
 * below, and the phone letterboxes the video. That keeps the driver's size list constant: it is
 * written once (one administrator prompt), never restarted for a new phone, rotation or split,
 * and switching sizes is instant.
 *
 * The list is also capped by the driver: Virtual Display Driver 25.7.26 stops offering any mode
 * at all, silently, once its list holds more than 14 resolutions (measured with its six stock
 * refresh rates: 14 load, 15 do not). This list is exactly 14 and every entry has been
 * accepted by the driver together with the others, so do not add one without removing another.
 * Five of them are the driver's own defaults, which stay in its file.
 */

import type { Size } from './split.ts'

export const MONITOR_SIZES: readonly Readonly<Size>[] = [
  // 16:9
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
  // 16:10
  { width: 1280, height: 800 },
  { width: 1920, height: 1200 },
  // 4:3
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1440, height: 1080 },
  // 1:1
  { width: 1080, height: 1080 },
  // portrait: 5:8, 3:4, 9:16
  { width: 800, height: 1280 },
  { width: 1080, height: 1440 },
  { width: 1080, height: 1920 },
]

/** A catalogue entry must have at least this share of the wanted pixels, so the picture stays sharp. */
const MIN_PIXEL_SHARE = 0.6

const area = (size: Size) => size.width * size.height

/** Shapes closer than this (in log aspect ratio, about 2%) count as the same shape. */
const SHAPE_STEP = 0.02

/**
 * The catalogue size to use for a monitor area of `target` physical pixels: the one whose
 * shape is closest to it (so the phone's black bars are thinnest) among those with enough
 * pixels. Sizes of practically the same shape are told apart by how close their pixel count is
 * to what was asked for. When nothing is big enough, the largest is used.
 */
export function pickMonitorSize(
  target: Size,
  catalogue: readonly Readonly<Size>[] = MONITOR_SIZES,
): Size {
  if (!(target.width > 0 && target.height > 0)) {
    throw new RangeError('target size must be positive')
  }
  const [first] = catalogue
  if (!first) throw new RangeError('catalogue is empty')
  const wantedArea = area(target)
  const wantedShape = target.width / target.height
  const shapeBucket = (size: Size) =>
    Math.floor(Math.abs(Math.log(size.width / size.height / wantedShape)) / SHAPE_STEP)
  const areaGap = (size: Size) => Math.abs(Math.log(area(size) / wantedArea))

  const sharp = catalogue.filter((size) => area(size) >= wantedArea * MIN_PIXEL_SHARE)
  const pool =
    sharp.length > 0
      ? sharp
      : [catalogue.reduce((largest, size) => (area(size) > area(largest) ? size : largest), first)]

  let best: Readonly<Size> = pool[0] ?? first
  for (const size of pool) {
    const better =
      shapeBucket(size) < shapeBucket(best) ||
      (shapeBucket(size) === shapeBucket(best) && areaGap(size) < areaGap(best))
    if (better) best = size
  }
  return { width: best.width, height: best.height }
}
