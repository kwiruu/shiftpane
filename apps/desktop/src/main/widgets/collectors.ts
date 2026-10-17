import { cpus, freemem, totalmem } from 'node:os'
import type { MediaState, SystemStats } from '@shiftpane/helper-client'
import { type MediaAction, MediaData, PcStatsData } from '@shiftpane/protocol'
import type { HelperChannel } from '../display/helper-host.ts'
import type { WidgetCollector } from './service.ts'

/** Gets the running helper, starting it if needed. */
export type HelperAccess = () => Promise<HelperChannel>

/** CPU use measured by Node between two calls; works on every OS, used when the helper cannot. */
export function createCpuMeter(read = cpus): () => number | null {
  let previous: { idle: number; total: number } | null = null
  return () => {
    let idle = 0
    let total = 0
    for (const { times } of read()) {
      idle += times.idle
      total += times.user + times.nice + times.sys + times.irq + times.idle
    }
    const before = previous
    previous = { idle, total }
    if (!before || total <= before.total) return null
    return Math.min(100, Math.max(0, (1 - (idle - before.idle) / (total - before.total)) * 100))
  }
}

const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.min(100, Math.max(0, value))

const bytes = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, value)

/**
 * The PC stats widget's data: the helper's numbers where it has them, Node's CPU and memory
 * figures where it does not (no helper, or another OS).
 */
export function toPcStats(
  helper: SystemStats | null,
  node: { cpuPercent: number | null; usedBytes: number; totalBytes: number },
): PcStatsData {
  const used = bytes(helper?.memoryUsedBytes) ?? node.usedBytes
  const total = bytes(helper?.memoryTotalBytes) ?? node.totalBytes
  const received = bytes(helper?.networkReceivedPerSecond)
  const sent = bytes(helper?.networkSentPerSecond)
  return PcStatsData.parse({
    cpuPercent: percent(helper?.cpuPercent) ?? percent(node.cpuPercent),
    memory: total > 0 ? { usedBytes: Math.min(used, total), totalBytes: total } : null,
    gpuPercent: percent(helper?.gpuPercent),
    network:
      received === null || sent === null
        ? null
        : { receivedPerSecond: received, sentPerSecond: sent },
  })
}

const text = (value: string | null) => (value ? value.slice(0, 256) : null)

/** The media widget's data from the helper's answer. */
export function toMedia(state: MediaState): MediaData {
  return MediaData.parse({
    status: state.status,
    title: text(state.title),
    artist: text(state.artist),
    app: text(state.app),
    canPlayPause: state.canPlayPause,
    canNext: state.canNext,
    canPrevious: state.canPrevious,
  })
}

export const NOTHING_PLAYING: MediaData = {
  status: 'none',
  title: null,
  artist: null,
  app: null,
  canPlayPause: false,
  canNext: false,
  canPrevious: false,
}

export function pcStatsCollector(
  helper: HelperAccess,
  cpuMeter = createCpuMeter(),
): WidgetCollector {
  return {
    intervalMs: 2_000,
    async collect() {
      // Node's meter runs every time so its own baseline stays fresh for when the helper fails.
      const node = {
        cpuPercent: cpuMeter(),
        usedBytes: totalmem() - freemem(),
        totalBytes: totalmem(),
      }
      let stats: SystemStats | null = null
      try {
        stats = await (await helper()).call('system.stats')
      } catch {
        stats = null
      }
      return toPcStats(stats, node)
    },
  }
}

export function mediaCollector(helper: HelperAccess): WidgetCollector {
  return {
    intervalMs: 1_000,
    onlyOnChange: true,
    async collect() {
      try {
        return toMedia(await (await helper()).call('media.state'))
      } catch {
        // No helper, or an OS without media controls: show "Nothing playing" rather than spin.
        return NOTHING_PLAYING
      }
    },
  }
}

export function pressMediaButton(helper: HelperAccess): (action: MediaAction) => Promise<void> {
  return async (action) => {
    await (await helper()).call('media.control', { action })
  }
}
