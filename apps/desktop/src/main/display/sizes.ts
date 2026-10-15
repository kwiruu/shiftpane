import type { DisplaySize } from '@shiftpane/helper-client'
import { computeSplit, type Quality, SPLIT_PRESETS } from '@shiftpane/layout'

/** Qualities the phone can stream at; `half` halves the physical pixels, so the size differs. */
const QUALITIES: readonly Quality[] = ['full', 'half']

/**
 * Every monitor size a phone can ask for: its streaming split presets, in both orientations,
 * at each stream quality. Sent to the helper in one `display.prepare` so Windows asks for
 * administrator approval once per phone rather than once per size.
 *
 * The list is derived from a viewport the phone reported, with width and height swapped for
 * the other orientation. That swap is only a guess: after a rotation a browser's toolbars change
 * the viewport, so the controller asks again with the viewport each `stream.request` carries,
 * and the sizes of the real new viewport are added in one more prompt.
 *
 * Full-quality sizes come first so a truncated list keeps the common ones. The result is
 * unique, and never longer than the helper accepts (3 presets x 2 orientations x 2 qualities).
 */
export function sizesForPhone(
  viewport: { width: number; height: number },
  devicePixelRatio: number,
): DisplaySize[] {
  const long = Math.max(viewport.width, viewport.height)
  const short = Math.min(viewport.width, viewport.height)
  const orientations = [
    { width: long, height: short },
    { width: short, height: long },
  ]
  const fractions = Object.values(SPLIT_PRESETS).filter((fraction) => fraction > 0)

  const sizes: DisplaySize[] = []
  const seen = new Set<string>()
  try {
    for (const quality of QUALITIES) {
      for (const orientation of orientations) {
        for (const monitorFraction of fractions) {
          const { stream } = computeSplit({
            viewport: orientation,
            devicePixelRatio,
            monitorFraction,
            quality,
          })
          if (!stream) continue
          const key = `${stream.width}x${stream.height}`
          if (seen.has(key)) continue
          seen.add(key)
          sizes.push({ width: stream.width, height: stream.height })
        }
      }
    }
  } catch (error) {
    // computeSplit rejects a non-positive viewport; the protocol schema already does too.
    if (error instanceof RangeError) return []
    throw error
  }
  return sizes
}
