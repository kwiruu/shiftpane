import type { MediaAction, PcMessage, PhoneMessage } from '@shiftpane/protocol'
import type { PhoneHub, PhoneInfo } from '../server/phone-hub.ts'

type WidgetUpdate = Extract<PcMessage, { type: 'widget.update' }>
export type WidgetData = WidgetUpdate['data']

/** Produces one widget's data on the PC. */
export interface WidgetCollector {
  /** How often to collect while a phone shows the widget. */
  intervalMs: number
  /** Send only when the data changed (media), instead of on every run (stats). */
  onlyOnChange?: boolean
  collect(): Promise<WidgetData>
}

export interface WidgetServiceOptions {
  hub: Pick<PhoneHub, 'on' | 'off' | 'send'>
  /** Collectors by widget id. Only these ids are ever run; `setCollectors` replaces them. */
  collectors: Record<string, WidgetCollector>
  /** Presses a media button on the PC. Without it, `media.control` is ignored. */
  mediaControl?: (action: MediaAction) => Promise<void>
  /** The widget to refresh after a media button, so the phone sees the result quickly. */
  mediaWidget?: string
  /** Wait this long after a media button before reading the new state. */
  mediaRefreshDelayMs?: number
  now?: () => number
  log?: (message: string) => void
}

interface Running {
  timer: ReturnType<typeof setInterval>
  busy: boolean
}

/**
 * Feeds the phones' widgets. A phone says which widgets it shows (`widgets.subscribe`); each
 * collector runs only while at least one phone shows its widget, and its data goes to exactly
 * those phones. A phone that subscribes to a widget that is already running gets the latest
 * data at once instead of waiting for the next run.
 *
 * The collectors can change while it runs (a widget installed, updated or removed): a phone that
 * already shows a widget gets its data as soon as there is a collector for it.
 */
export class WidgetService {
  readonly #options: WidgetServiceOptions
  readonly #log: (message: string) => void
  readonly #unhook: Array<() => void> = []
  readonly #subscriptions = new Map<string, Set<string>>()
  readonly #running = new Map<string, Running>()
  readonly #last = new Map<string, { json: string; message: WidgetUpdate }>()
  #collectors: Record<string, WidgetCollector>
  #stopped = false

  constructor(options: WidgetServiceOptions) {
    this.#options = options
    this.#collectors = options.collectors
    this.#log = options.log ?? (() => {})
    const { hub } = options
    const onMessage = (phone: PhoneInfo, message: PhoneMessage) => this.#onMessage(phone, message)
    const onChange = (phones: PhoneInfo[]) => {
      const present = new Set(phones.map((phone) => phone.id))
      for (const id of this.#subscriptions.keys()) {
        if (!present.has(id)) this.#subscriptions.delete(id)
      }
      this.#reconcile()
    }
    hub.on('message', onMessage)
    hub.on('change', onChange)
    this.#unhook.push(
      () => hub.off('message', onMessage),
      () => hub.off('change', onChange),
    )
  }

  /** Collects a widget again soon, after a button changed what it shows. */
  refresh(id: string, delayMs = this.#options.mediaRefreshDelayMs ?? 250): void {
    setTimeout(() => void this.#run(id, true), delayMs)
  }

  stop(): void {
    this.#stopped = true
    for (const running of this.#running.values()) clearInterval(running.timer)
    this.#running.clear()
    this.#subscriptions.clear()
    for (const unhook of this.#unhook.splice(0)) unhook()
  }

  /**
   * Replaces the collectors. A widget whose collector changed or went away stops; one that some
   * phone shows and now has a collector starts.
   */
  setCollectors(collectors: Record<string, WidgetCollector>): void {
    const before = this.#collectors
    this.#collectors = collectors
    for (const [id, running] of this.#running) {
      if (this.#collector(id) === (Object.hasOwn(before, id) ? before[id] : undefined)) continue
      clearInterval(running.timer)
      this.#running.delete(id)
      this.#last.delete(id)
    }
    this.#reconcile()
  }

  #collector(id: string): WidgetCollector | undefined {
    return Object.hasOwn(this.#collectors, id) ? this.#collectors[id] : undefined
  }

  #onMessage(phone: PhoneInfo, message: PhoneMessage): void {
    if (message.type === 'widgets.subscribe') {
      const before = this.#subscriptions.get(phone.id) ?? new Set<string>()
      // Kept even without a collector yet: the widget may be installed later.
      const wanted = new Set(message.widgets)
      this.#subscriptions.set(phone.id, wanted)
      for (const id of wanted) {
        const last = this.#last.get(id)
        if (!before.has(id) && last) this.#options.hub.send(phone.id, last.message)
      }
      this.#reconcile()
    } else if (message.type === 'media.control') {
      void this.#press(message.action)
    }
  }

  async #press(action: MediaAction): Promise<void> {
    const { mediaControl, mediaWidget } = this.#options
    if (!mediaControl) return
    try {
      await mediaControl(action)
    } catch (error) {
      this.#log(`media ${action} failed: ${error instanceof Error ? error.message : error}`)
    }
    if (!mediaWidget) return
    setTimeout(() => void this.#run(mediaWidget, true), this.#options.mediaRefreshDelayMs ?? 250)
  }

  /** Starts collectors some phone needs and stops the ones no phone needs any more. */
  #reconcile(): void {
    if (this.#stopped) return
    const needed = new Set<string>()
    for (const widgets of this.#subscriptions.values()) for (const id of widgets) needed.add(id)
    for (const id of needed) {
      const collector = this.#collector(id)
      if (!collector || this.#running.has(id)) continue
      const timer = setInterval(() => void this.#run(id), collector.intervalMs)
      this.#running.set(id, { timer, busy: false })
      void this.#run(id)
    }
    for (const [id, running] of this.#running) {
      if (needed.has(id)) continue
      clearInterval(running.timer)
      this.#running.delete(id)
      this.#last.delete(id)
    }
  }

  /** Collects once and sends the result to every phone showing the widget. */
  async #run(id: string, force = false): Promise<void> {
    const running = this.#running.get(id)
    const collector = this.#collector(id)
    if (!running || !collector || running.busy) return
    running.busy = true
    try {
      const data = await collector.collect()
      if (this.#running.get(id) !== running) return
      const json = JSON.stringify(data)
      if (collector.onlyOnChange && !force && this.#last.get(id)?.json === json) return
      const message: WidgetUpdate = {
        type: 'widget.update',
        instanceId: id,
        widgetId: id,
        data,
        at: (this.#options.now ?? Date.now)(),
      }
      this.#last.set(id, { json, message })
      for (const [phoneId, widgets] of this.#subscriptions) {
        if (widgets.has(id)) this.#options.hub.send(phoneId, message)
      }
    } catch (error) {
      this.#log(`widget ${id} failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      running.busy = false
    }
  }
}
