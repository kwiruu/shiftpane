import type { DisplaySize } from '@shiftpane/helper-client'
import { MONITOR_SIZES } from '@shiftpane/layout'

/**
 * Every monitor size the app ever asks the driver for: the fixed catalogue in
 * `@shiftpane/layout`, the same for every phone and every rotation.
 *
 * It is sent to the helper in one `display.prepare` when the first phone pairs. On a machine
 * where the driver already offers all of it, that is no helper work at all; otherwise it is one
 * administrator prompt, once, and no pairing, rotation or split change prompts again.
 */
export function catalogueSizes(): DisplaySize[] {
  return MONITOR_SIZES.map(({ width, height }) => ({ width, height }))
}
