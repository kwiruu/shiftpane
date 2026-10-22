import { freemem, totalmem, uptime, version } from 'node:os'
import type { MediaState, SystemStats } from '@shiftpane/helper-client'
import type { SourceName, Sources } from '@shiftpane/widget-sdk'
import { createCpuMeter, type HelperAccess, toPcStats } from './collectors.ts'

/** Sources read from the PC's load, sampled once a second while some widget reads them. */
const SAMPLED: ReadonlySet<SourceName> = new Set(['cpu', 'memory', 'gpu', 'network'])

/** How many samples each source's `history` keeps: a minute. */
export const SOURCE_HISTORY = 60

interface Sample {
  cpu: number | null
  memory: { used: number; total: number } | null
  gpu: number | null
  network: { received: number; sent: number } | null
}

export interface SourceReaderOptions {
  helper: HelperAccess
  intervalMs?: number
  /** Sampling stops when no widget has read a sampled source for this long. */
  idleMs?: number
  cpuMeter?: () => number | null
  log?: (message: string) => void
}

/**
 * The system sources installed widgets read. CPU, memory, GPU and network come from the helper
 * (Node's own figures where it can't), sampled once a second from the first read until no widget
 * has read one for a while, so each has a minute of history; media is asked for when read;
 * system comes from Node. The other sources
 * aren't read on this PC yet: a widget that declares one sees nothing there.
 */
export class SourceReader {
  readonly #options: SourceReaderOptions
  readonly #cpuMeter: () => number | null
  readonly #samples: Sample[] = []
  #timer: ReturnType<typeof setInterval> | undefined
  #sampling: Promise<void> | null = null
  #until = 0
  #media: { at: number; value: MediaState | null } | null = null

  constructor(options: SourceReaderOptions) {
    this.#options = options
    this.#cpuMeter = options.cpuMeter ?? createCpuMeter()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
    this.#samples.length = 0
  }

  /** Samples from now until no sampled source has been read for a while. */
  #keepSampling(): void {
    this.#until = Date.now() + (this.#options.idleMs ?? 5000)
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => {
      if (Date.now() > this.#until) this.stop()
      else void this.#sample()
    }, this.#options.intervalMs ?? 1000)
  }

  /** The named sources as they are now. */
  async read(names: readonly SourceName[]): Promise<Sources> {
    if (names.some((name) => SAMPLED.has(name))) {
      this.#keepSampling()
      if (this.#samples.length === 0) await this.#sample()
    }
    const sources: Sources = {}
    const latest = this.#samples.at(-1)
    const history = <T>(pick: (sample: Sample) => T) => this.#samples.map(pick)
    for (const name of names) {
      switch (name) {
        case 'cpu':
          sources.cpu = { percent: latest?.cpu ?? null, history: history((s) => s.cpu) }
          break
        case 'memory': {
          const memory = latest?.memory
          sources.memory = {
            percent: memory && memory.total > 0 ? (memory.used / memory.total) * 100 : null,
            used: memory?.used ?? null,
            total: memory?.total ?? null,
            history: history((s) =>
              s.memory && s.memory.total > 0 ? (s.memory.used / s.memory.total) * 100 : null,
            ),
          }
          break
        }
        case 'gpu':
          sources.gpu = { percent: latest?.gpu ?? null, history: history((s) => s.gpu) }
          break
        case 'network':
          sources.network = {
            receivedPerSecond: latest?.network?.received ?? null,
            sentPerSecond: latest?.network?.sent ?? null,
            history: history((s) => s.network?.received ?? null),
          }
          break
        case 'media': {
          const media = await this.#readMedia()
          const playing = media?.status === 'playing'
          sources.media = {
            title: media && media.status !== 'none' ? media.title : null,
            artist: media && media.status !== 'none' ? media.artist : null,
            app: media && media.status !== 'none' ? media.app : null,
            playing,
          }
          break
        }
        case 'system':
          sources.system = { uptimeSeconds: Math.round(uptime()), os: version().slice(0, 256) }
          break
        default:
          // disks, battery, audio, temperatures, processes, active-window: not read yet.
          break
      }
    }
    return sources
  }

  #sample(): Promise<void> {
    this.#sampling ??= this.#takeSample().finally(() => {
      this.#sampling = null
    })
    return this.#sampling
  }

  async #takeSample(): Promise<void> {
    // Node's meter runs every time so its own baseline stays fresh for when the helper fails.
    const node = {
      cpuPercent: this.#cpuMeter(),
      usedBytes: totalmem() - freemem(),
      totalBytes: totalmem(),
    }
    let helper: SystemStats | null = null
    try {
      helper = await (await this.#options.helper()).call('system.stats')
    } catch {
      helper = null
    }
    const stats = toPcStats(helper, node)
    this.#samples.push({
      cpu: stats.cpuPercent,
      memory: stats.memory
        ? { used: stats.memory.usedBytes, total: stats.memory.totalBytes }
        : null,
      gpu: stats.gpuPercent,
      network: stats.network
        ? { received: stats.network.receivedPerSecond, sent: stats.network.sentPerSecond }
        : null,
    })
    if (this.#samples.length > SOURCE_HISTORY) this.#samples.shift()
  }

  /** What is playing, asked for at most once a second however many widgets read it. */
  async #readMedia(): Promise<MediaState | null> {
    const now = Date.now()
    if (this.#media && now - this.#media.at < 1000) return this.#media.value
    let value: MediaState | null = null
    try {
      value = await (await this.#options.helper()).call('media.state')
    } catch {
      value = null
    }
    this.#media = { at: now, value }
    return value
  }
}
