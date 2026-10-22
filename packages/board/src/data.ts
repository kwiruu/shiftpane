import {
  type InstalledWidget,
  InstalledWidgetData,
  MEDIA_WIDGET,
  MediaData,
  type MonitorInfo,
  PC_STATS_WIDGET,
  type PcMessage,
  PcStatsData,
} from '@shiftpane/protocol'

/** One PC stats update, reduced to the numbers the widgets chart. Null where the PC had none. */
export interface StatsSample {
  cpu: number | null
  gpu: number | null
  memory: number | null
  down: number | null
  up: number | null
}

/** How many recent PC stats updates the charts keep (about a minute at one per second). */
export const HISTORY_LENGTH = 60

/** Everything the PC has told the phone that is not video: widget data and its monitors. */
export interface PcData {
  pcStats: { data: PcStatsData; at: number } | null
  /** Recent PC stats, oldest first, at most HISTORY_LENGTH. */
  history: StatsSample[]
  media: { data: MediaData; at: number } | null
  /** The PC's real monitors, which the phone can duplicate. */
  monitors: MonitorInfo[]
  /** The widgets installed on the PC, which a board can place besides the built-in ones. */
  installed: InstalledWidget[]
  /** The latest data of each installed widget some table shows, by widget id. */
  widgets: Record<string, { data: InstalledWidgetData; at: number }>
}

const EMPTY: PcData = {
  pcStats: null,
  history: [],
  media: null,
  monitors: [],
  installed: [],
  widgets: {},
}

export function sampleOf(stats: PcStatsData): StatsSample {
  const { memory, network } = stats
  return {
    cpu: stats.cpuPercent,
    gpu: stats.gpuPercent,
    memory: memory && memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : null,
    down: network?.receivedPerSecond ?? null,
    up: network?.sentPerSecond ?? null,
  }
}

/**
 * Holds the latest widget data and monitor list from the PC, for React to read with
 * `useSyncExternalStore`. Widget data is parsed again with the widget's own schema: the
 * protocol only checks that it is JSON, so a malformed update is dropped here, not rendered.
 */
export class PcDataStore {
  readonly #listeners = new Set<() => void>()
  #state: PcData = EMPTY

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getState = (): PcData => this.#state

  handle(message: PcMessage): void {
    switch (message.type) {
      case 'monitors':
        this.#set({ ...this.#state, monitors: message.monitors })
        return
      case 'widgets.installed':
        this.#set({ ...this.#state, installed: message.widgets })
        return
      case 'widget.update': {
        if (message.widgetId === PC_STATS_WIDGET) {
          const parsed = PcStatsData.safeParse(message.data)
          if (parsed.success)
            this.#set({
              ...this.#state,
              pcStats: { data: parsed.data, at: message.at },
              history: [...this.#state.history, sampleOf(parsed.data)].slice(-HISTORY_LENGTH),
            })
        } else if (message.widgetId === MEDIA_WIDGET) {
          const parsed = MediaData.safeParse(message.data)
          if (parsed.success)
            this.#set({ ...this.#state, media: { data: parsed.data, at: message.at } })
        } else {
          const parsed = InstalledWidgetData.safeParse(message.data)
          if (parsed.success)
            this.#set({
              ...this.#state,
              widgets: {
                ...this.#state.widgets,
                [message.widgetId]: { data: parsed.data, at: message.at },
              },
            })
        }
        return
      }
      default:
        return
    }
  }

  /**
   * The connection dropped: nothing shown so far is current any more. What the installed
   * widgets look like is kept, so they wait for the PC rather than show as missing.
   */
  reset(): void {
    this.#set({ ...EMPTY, installed: this.#state.installed })
  }

  #set(state: PcData): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}
