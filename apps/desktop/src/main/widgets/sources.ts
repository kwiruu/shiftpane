import { type CpuInfo, cpus, freemem, totalmem, uptime, version } from 'node:os'
import { bytesParts } from '@shiftpane/board/format'
import type {
  ActiveWindow,
  AudioState,
  Battery,
  DriveInfo,
  MediaState,
  ProcessLoad,
  SystemStats,
} from '@shiftpane/helper-client'
import type { SourceName, Sources } from '@shiftpane/widget-sdk'
import { createCpuMeter, type HelperAccess, toPcStats } from './collectors.ts'

/** Sources read from the PC's load, sampled once a second while some widget reads them. */
const SAMPLED: ReadonlySet<SourceName> = new Set([
  'cpu',
  'memory',
  'gpu',
  'network',
  'temperatures',
])

/** How many samples each source's `history` keeps: a minute. */
export const SOURCE_HISTORY = 60

/** How long a reading asked of the helper is reused, however many widgets read it. */
const FRESH_MS = {
  disks: 1500,
  processes: 1500,
  power: 5000,
  audio: 1000,
  window: 1000,
  media: 1000,
}

interface Sample {
  cpu: number | null
  cores: number[]
  memory: { used: number; total: number } | null
  gpu: number | null
  gpuTemperature: number | null
  gpuFan: number | null
  network: { received: number; sent: number } | null
}

export interface SourceReaderOptions {
  helper: HelperAccess
  intervalMs?: number
  /** Sampling stops when no widget has read a sampled source for this long. */
  idleMs?: number
  cpuMeter?: () => number | null
  /** Each core's busy share since the previous call; Node's own figures. */
  coreMeter?: () => number[]
  log?: (message: string) => void
}

/** Each core's busy share between two calls, from Node. */
export function createCoreMeter(read: () => CpuInfo[] = cpus): () => number[] {
  let previous: { idle: number; total: number }[] = []
  return () => {
    const now = read().map(({ times }) => ({
      idle: times.idle,
      total: times.user + times.nice + times.sys + times.irq + times.idle,
    }))
    const before = previous
    previous = now
    return now.flatMap((core, index) => {
      const was = before[index]
      if (!was || core.total <= was.total) return []
      const busy = (1 - (core.idle - was.idle) / (core.total - was.total)) * 100
      return [Math.round(Math.min(100, Math.max(0, busy)))]
    })
  }
}

const sizeText = (bytes: number) => {
  const { value, unit } = bytesParts(bytes)
  return `${value} ${unit}`
}

/**
 * The system sources installed widgets read, in the shapes `sourceSchemas` in the SDK gives.
 *
 * CPU, memory, GPU, network and temperatures come from the helper (Node's own figures where it
 * can't), sampled once a second from the first read until no widget has read one for a while, so
 * each has a minute of history. Drives, processes, the battery, audio, the active window and media
 * are asked of the helper when read, at most once every second or so. System comes from Node. A
 * reading this PC can't take is null, never a guess.
 */
export class SourceReader {
  readonly #options: SourceReaderOptions
  readonly #cpuMeter: () => number | null
  readonly #coreMeter: () => number[]
  readonly #samples: Sample[] = []
  readonly #fresh = new Map<string, { at: number; value: Promise<unknown> }>()
  #timer: ReturnType<typeof setInterval> | undefined
  #sampling: Promise<void> | null = null
  #until = 0

  constructor(options: SourceReaderOptions) {
    this.#options = options
    this.#cpuMeter = options.cpuMeter ?? createCpuMeter()
    this.#coreMeter = options.coreMeter ?? createCoreMeter()
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

  /** A helper reading, reused while fresh; null when the helper can't give it. */
  #ask<T>(key: keyof typeof FRESH_MS, call: () => Promise<T>): Promise<T | null> {
    const now = Date.now()
    const known = this.#fresh.get(key)
    if (known && now - known.at < FRESH_MS[key]) return known.value as Promise<T | null>
    const value = call().catch(() => null)
    this.#fresh.set(key, { at: now, value })
    return value
  }

  async #helper() {
    return this.#options.helper()
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
          sources.cpu = {
            percent: latest?.cpu ?? null,
            cores: latest?.cores ?? [],
            history: history((s) => s.cpu),
          }
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
        case 'temperatures':
          // CPU temperature needs a kernel driver on Windows, which ShiftPane doesn't install.
          sources.temperatures = {
            cpu: null,
            gpu: latest?.gpuTemperature ?? null,
            fans: latest?.gpuFan ? [latest.gpuFan] : [],
          }
          break
        case 'disks': {
          const drives = await this.#ask<DriveInfo[]>('disks', async () => {
            const result = await (await this.#helper()).call('disks.state')
            return result.drives
          })
          sources.disks = {
            drives: (drives ?? []).map((drive) => ({
              name: drive.name,
              used: drive.usedBytes,
              total: drive.totalBytes,
              percent:
                drive.totalBytes > 0 ? Math.round((drive.usedBytes / drive.totalBytes) * 100) : 0,
              readPerSecond: drive.readPerSecond,
              writePerSecond: drive.writePerSecond,
            })),
          }
          break
        }
        case 'processes': {
          const top = await this.#ask<ProcessLoad[]>('processes', async () => {
            const result = await (await this.#helper()).call('processes.top')
            return result.processes
          })
          sources.processes = {
            top: (top ?? []).map((process) => ({
              title: process.name.slice(0, 256),
              ...(process.memoryBytes !== null && { subtitle: sizeText(process.memoryBytes) }),
              value: `${Math.round(process.cpuPercent)}%`,
              cpuPercent: Math.min(100, Math.max(0, process.cpuPercent)),
              memoryBytes: process.memoryBytes,
            })),
          }
          break
        }
        case 'battery': {
          const battery = await this.#ask<Battery | null>('power', async () => {
            const result = await (await this.#helper()).call('power.state')
            return result.battery
          })
          sources.battery = {
            percent: battery?.percent ?? null,
            charging: battery ? battery.charging : null,
            minutesLeft: battery?.minutesLeft ?? null,
          }
          break
        }
        case 'audio': {
          const audio = await this.#ask<AudioState>('audio', async () => {
            const result = await (await this.#helper()).call('audio.state')
            const { type: _, ...state } = result
            return state
          })
          sources.audio = {
            volume: audio?.volumePercent ?? null,
            muted: audio?.muted ?? null,
            device: audio?.device ?? null,
          }
          break
        }
        case 'active-window': {
          const window = await this.#ask<ActiveWindow>('window', async () => {
            const result = await (await this.#helper()).call('window.active')
            const { type: _, ...active } = result
            return active
          })
          sources['active-window'] = { app: window?.app ?? null, title: window?.title ?? null }
          break
        }
        case 'media': {
          const media = await this.#ask<MediaState>('media', async () => {
            const result = await (await this.#helper()).call('media.state')
            const { type: _, ...state } = result
            return state
          })
          const playing = media?.status === 'playing'
          const known = media && media.status !== 'none'
          sources.media = {
            title: known ? media.title : null,
            artist: known ? media.artist : null,
            app: known ? media.app : null,
            playing,
          }
          break
        }
        case 'system':
          sources.system = { uptimeSeconds: Math.round(uptime()), os: version().slice(0, 256) }
          break
      }
    }
    return sources
  }

  /** Forgets a reading, so the next read asks again (after a button changed it). */
  forget(key: keyof typeof FRESH_MS): void {
    this.#fresh.delete(key)
  }

  #sample(): Promise<void> {
    this.#sampling ??= this.#takeSample().finally(() => {
      this.#sampling = null
    })
    return this.#sampling
  }

  async #takeSample(): Promise<void> {
    // Node's meters run every time so their own baseline stays fresh for when the helper fails.
    const node = {
      cpuPercent: this.#cpuMeter(),
      usedBytes: totalmem() - freemem(),
      totalBytes: totalmem(),
    }
    const cores = this.#coreMeter()
    let helper: SystemStats | null = null
    try {
      helper = await (await this.#helper()).call('system.stats')
    } catch {
      helper = null
    }
    const stats = toPcStats(helper, node)
    this.#samples.push({
      cpu: stats.cpuPercent,
      cores,
      memory: stats.memory
        ? { used: stats.memory.usedBytes, total: stats.memory.totalBytes }
        : null,
      gpu: stats.gpuPercent,
      gpuTemperature: helper?.gpuTemperatureCelsius ?? null,
      gpuFan: helper?.gpuFanRpm ?? null,
      network: stats.network
        ? { received: stats.network.receivedPerSecond, sent: stats.network.sentPerSecond }
        : null,
    })
    if (this.#samples.length > SOURCE_HISTORY) this.#samples.shift()
  }
}
