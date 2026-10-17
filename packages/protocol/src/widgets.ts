/**
 * Data the PC sends for the built-in widgets that need the PC, in `widget.update` messages.
 *
 * The PC collects; the phone only ever receives these finished numbers and strings. Both sides
 * parse with the same schemas, so a field the PC cannot read is `null`, never a guess.
 */

import { z } from 'zod'

/** Widget ids: lowercase letters, digits and dashes, like a widget manifest's `id`. */
export const WidgetId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
export type WidgetId = z.infer<typeof WidgetId>

export const PC_STATS_WIDGET = 'pc-stats'
export const MEDIA_WIDGET = 'media'

const Percent = z.number().min(0).max(100)
const Bytes = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** CPU, memory, GPU and network load of the PC. */
export const PcStatsData = z.object({
  cpuPercent: Percent.nullable(),
  memory: z.object({ usedBytes: Bytes, totalBytes: Bytes }).nullable(),
  gpuPercent: Percent.nullable(),
  network: z.object({ receivedPerSecond: Bytes, sentPerSecond: Bytes }).nullable(),
})
export type PcStatsData = z.infer<typeof PcStatsData>

const Text = z.string().max(256)

/** What the PC is playing, as the OS media controls report it. */
export const MediaData = z.object({
  status: z.enum(['playing', 'paused', 'stopped', 'none']),
  title: Text.nullable(),
  artist: Text.nullable(),
  /** The app that is playing, e.g. "Spotify". */
  app: Text.nullable(),
  canPlayPause: z.boolean(),
  canNext: z.boolean(),
  canPrevious: z.boolean(),
})
export type MediaData = z.infer<typeof MediaData>

/** The fixed set of media buttons the phone can press. There is no free-form command. */
export const MediaAction = z.enum(['play-pause', 'next', 'previous'])
export type MediaAction = z.infer<typeof MediaAction>
