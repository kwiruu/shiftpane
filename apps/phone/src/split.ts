import { SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'

/**
 * What a phone shows until someone picks a split: the widgets alone. The virtual monitor is
 * opt-in, so a freshly paired phone does not make the PC add a display.
 */
export const DEFAULT_SPLIT: SplitPreset = 'widgets'

/** A saved split, or the default when there is none or it names a split this version lacks. */
export function parseSplit(saved: unknown): SplitPreset {
  // `hasOwn`, not `in`: "toString" is `in` every object.
  return typeof saved === 'string' && Object.hasOwn(SPLIT_PRESETS, saved)
    ? (saved as SplitPreset)
    : DEFAULT_SPLIT
}
