import {
  type InstalledWidget,
  type InstalledWidgetData,
  MEDIA_WIDGET,
  type MediaAction,
  type MediaData,
  type MonitorInfo,
  PC_STATS_WIDGET,
  type PcStatsData,
} from '@shiftpane/protocol'
import { pickSources, type SourceName, type Sources, sampleSources } from '@shiftpane/widget-sdk'
import { HISTORY_LENGTH, PcDataStore } from './data.ts'

/**
 * Made-up PC data for previews: the phone's demo mode and the desktop editor. Stats wander a
 * little each second and the media player answers its buttons. Nothing leaves the page.
 */

const MONITORS: MonitorInfo[] = [
  { id: 'demo-1', name: 'Studio Display', width: 2560, height: 1440, primary: true },
  { id: 'demo-2', name: 'Side monitor', width: 1920, height: 1080, primary: false },
]

const TRACKS = [
  { title: 'Late Night Drive', artist: 'Neon Coast', app: 'Spotify' },
  { title: 'Paper Lanterns', artist: 'Mira Vale', app: 'Spotify' },
  { title: 'Slow Orbit', artist: 'The Quiet Hours', app: 'Spotify' },
]

const GB = 1024 ** 3
const MB = 1024 ** 2

const wander = (value: number, step: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value + (Math.random() - 0.5) * 2 * step))

/**
 * An installed widget as a preview shows it: its view, with its `sample.json` standing in for
 * the collector's output, its config, and the sources it declared, read from the sample PC.
 */
export interface SampleInstalled extends InstalledWidget {
  sample: Record<string, unknown>
  config: Record<string, unknown>
  sources: readonly SourceName[]
}

export class SampleFeed {
  readonly store = new PcDataStore()
  #track = 0
  #playing = true
  #cpu = 28
  #gpu = 14
  #memory = 9.4 * GB
  #down = 2.4 * MB
  #up = 180 * 1024
  #timer: ReturnType<typeof setInterval> | undefined
  #installed: SampleInstalled[] = []
  #drafts: SampleInstalled[] = []

  /** Starts the feed; calling it again does nothing. */
  start(): void {
    if (this.#timer !== undefined) return
    this.store.handle({ type: 'monitors', monitors: MONITORS })
    // A minute of history up front, so the charts are full from the first frame.
    const now = Date.now()
    for (let i = HISTORY_LENGTH; i > 0; i -= 1)
      this.#update(PC_STATS_WIDGET, this.#stats(), now - i * 1000)
    this.#update(MEDIA_WIDGET, this.#media())
    this.#updateInstalled()
    this.#timer = setInterval(() => {
      this.#update(PC_STATS_WIDGET, this.#stats())
      this.#updateInstalled()
    }, 1000)
  }

  /** The installed widgets to preview, replacing any shown before. */
  showInstalled(widgets: SampleInstalled[]): void {
    this.#installed = widgets
    this.#publishInstalled()
  }

  /**
   * Widgets being made (Widget Studio's), previewed like installed ones until they're saved. A
   * draft with an installed widget's id stands in for it.
   */
  showDrafts(widgets: SampleInstalled[]): void {
    this.#drafts = widgets
    this.#publishInstalled()
  }

  #all(): SampleInstalled[] {
    const drafted = new Set(this.#drafts.map((widget) => widget.id))
    return [...this.#installed.filter((widget) => !drafted.has(widget.id)), ...this.#drafts]
  }

  #publishInstalled(): void {
    this.store.handle({
      type: 'widgets.installed',
      widgets: this.#all().map(({ sample: _, config: __, sources: ___, ...widget }) => widget),
    })
    this.#updateInstalled()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** A media button: play/pause toggles, next and previous change the track. */
  press(action: MediaAction): void {
    if (action === 'play-pause') this.#playing = !this.#playing
    if (action === 'next') this.#track = (this.#track + 1) % TRACKS.length
    if (action === 'previous') this.#track = (this.#track + TRACKS.length - 1) % TRACKS.length
    this.#update(MEDIA_WIDGET, this.#media())
    this.#updateInstalled()
  }

  #update(widgetId: string, data: PcStatsData | MediaData | InstalledWidgetData, at = Date.now()) {
    this.store.handle({ type: 'widget.update', instanceId: widgetId, widgetId, data, at })
  }

  #updateInstalled(): void {
    const widgets = this.#all()
    if (widgets.length === 0) return
    const all = this.#sources()
    for (const widget of widgets) {
      this.#update(widget.id, {
        sources: pickSources(all, widget.sources) as InstalledWidgetData['sources'],
        output: widget.sample as InstalledWidgetData['output'],
        config: widget.config as InstalledWidgetData['config'],
        problem: null,
      })
    }
  }

  /** The sample PC, moving: its stats and track as the built-in widgets show them right now. */
  #sources(): Sources {
    const { history } = this.store.getState()
    const track = TRACKS[this.#track] ?? TRACKS[0]
    const total = 16 * GB
    return {
      ...sampleSources,
      cpu: {
        percent: this.#cpu,
        cores: sampleSources.cpu.cores,
        history: history.map((sample) => sample.cpu),
      },
      memory: {
        percent: (this.#memory / total) * 100,
        used: this.#memory,
        total,
        history: history.map((sample) => sample.memory),
      },
      gpu: { ...sampleSources.gpu, percent: this.#gpu, history: history.map((s) => s.gpu) },
      network: {
        receivedPerSecond: this.#down,
        sentPerSecond: this.#up,
        history: history.map((sample) => sample.down),
      },
      media: {
        title: track?.title ?? null,
        artist: track?.artist ?? null,
        app: track?.app ?? null,
        playing: this.#playing,
      },
    }
  }

  #stats(): PcStatsData {
    this.#cpu = wander(this.#cpu, 9, 3, 96)
    this.#gpu = wander(this.#gpu, 6, 0, 90)
    this.#memory = wander(this.#memory, 0.15 * GB, 6 * GB, 14 * GB)
    this.#down = wander(this.#down, 0.9 * MB, 40 * 1024, 9 * MB)
    this.#up = wander(this.#up, 90 * 1024, 8 * 1024, 1.2 * MB)
    return {
      cpuPercent: this.#cpu,
      memory: { usedBytes: this.#memory, totalBytes: 16 * GB },
      gpuPercent: this.#gpu,
      network: { receivedPerSecond: this.#down, sentPerSecond: this.#up },
    }
  }

  #media(): MediaData {
    const track = TRACKS[this.#track] ?? TRACKS[0]
    return {
      status: this.#playing ? 'playing' : 'paused',
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      app: track?.app ?? null,
      canPlayPause: true,
      canNext: true,
      canPrevious: true,
    }
  }
}
