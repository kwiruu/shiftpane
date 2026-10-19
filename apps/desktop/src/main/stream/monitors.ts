import { EventEmitter } from 'node:events'
import type { DisplayInfo } from '@shiftpane/helper-client'
import { type MonitorInfo, MonitorSource } from '@shiftpane/protocol'
import type { DisplayController } from '../display/controller.ts'
import type { PhoneHub, PhoneInfo } from '../server/phone-hub.ts'
import type { Rect } from './match.ts'

/** The part of Electron's `screen` module used to list the PC's monitors. */
export interface MonitorScreen {
  getAllDisplays(): Array<{ id: number; label: string; bounds: Rect }>
  getPrimaryDisplay(): { id: number }
  /** DIPs to physical pixels; `null` converts in the desktop's own coordinate space. */
  dipToScreenRect(window: null, rect: Rect): Rect
}

/** Most monitors the `monitors` message may carry. */
const MAX_MONITORS = 16

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/**
 * The monitors a phone can duplicate: every display on the desktop except the virtual one
 * ShiftPane attached (`virtual`, in physical pixels), main display first, then left to right.
 */
export function listMonitors(screen: MonitorScreen, virtual: Rect | null): MonitorInfo[] {
  const primary = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .map((display) => ({ display, rect: screen.dipToScreenRect(null, display.bounds) }))
    .filter(({ rect }) => !(virtual && sameRect(rect, virtual)))
    .sort((a, b) => {
      const primaryFirst = Number(b.display.id === primary) - Number(a.display.id === primary)
      return primaryFirst || a.rect.x - b.rect.x || a.rect.y - b.rect.y
    })
    .slice(0, MAX_MONITORS)
    .map(({ display, rect }) => ({
      id: String(display.id),
      name: display.label.trim().slice(0, 128),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      primary: display.id === primary,
    }))
}

/**
 * What the desktop window may tell a phone to show: the virtual monitor, or a copy of a monitor
 * that is in `monitors` now. Anything else, including a copy of the virtual monitor (which is
 * not listed) or of one that was unplugged, is refused with null.
 */
export function acceptSource(
  source: unknown,
  monitors: readonly MonitorInfo[],
): MonitorSource | null {
  const parsed = MonitorSource.safeParse(source)
  if (!parsed.success) return null
  const { data } = parsed
  if (data.kind === 'mirror' && !monitors.some((monitor) => monitor.id === data.displayId)) {
    return null
  }
  return data
}

export interface MonitorAnnouncerOptions {
  hub: Pick<PhoneHub, 'on' | 'off' | 'send' | 'phones'>
  display: Pick<DisplayController, 'on' | 'off'>
  screen: MonitorScreen
  /** Calls `onChange` when monitors are added, removed or change resolution; returns an unhook. */
  watch(onChange: () => void): () => void
  /** Waits this long after a burst of changes before telling the phones. */
  debounceMs?: number
}

/**
 * Keeps every phone's list of the PC's monitors current: a phone gets the list right after it
 * pairs, and all phones get it again when monitors change or the virtual monitor (which is
 * left out) comes and goes. Unchanged lists are not sent again.
 *
 * The desktop window shows the same list, to pick what a phone's monitor area shows: it reads
 * `list` and hears `change` when the list changes.
 */
export class MonitorAnnouncer extends EventEmitter<{ change: [MonitorInfo[]] }> {
  readonly #options: MonitorAnnouncerOptions
  readonly #unhook: Array<() => void> = []
  readonly #told = new Set<string>()
  #virtual: Rect | null = null
  #last = ''
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: MonitorAnnouncerOptions) {
    super()
    this.#options = options
    const { hub, display } = options

    const onChange = (phones: PhoneInfo[]) => {
      const present = new Set(phones.map((phone) => phone.id))
      for (const id of this.#told) if (!present.has(id)) this.#told.delete(id)
      const list = this.#list()
      for (const phone of phones) {
        if (this.#told.has(phone.id)) continue
        this.#told.add(phone.id)
        hub.send(phone.id, { type: 'monitors', monitors: list })
      }
    }
    const onAttached = ({ display: info }: { display: DisplayInfo }) => {
      this.#virtual = { x: info.x, y: info.y, width: info.width, height: info.height }
      this.#schedule()
    }
    const onDetached = () => {
      this.#virtual = null
      this.#schedule()
    }

    hub.on('change', onChange)
    display.on('attached', onAttached)
    display.on('detached', onDetached)
    this.#unhook.push(
      () => hub.off('change', onChange),
      () => display.off('attached', onAttached),
      () => display.off('detached', onDetached),
      options.watch(() => this.#schedule()),
    )
  }

  /** The monitors a phone can copy, as they are now. */
  get list(): MonitorInfo[] {
    return listMonitors(this.#options.screen, this.#virtual)
  }

  stop(): void {
    clearTimeout(this.#timer)
    for (const unhook of this.#unhook.splice(0)) unhook()
  }

  #list(): MonitorInfo[] {
    const list = listMonitors(this.#options.screen, this.#virtual)
    this.#last = JSON.stringify(list)
    return list
  }

  #schedule(): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#broadcast(), this.#options.debounceMs ?? 300)
  }

  #broadcast(): void {
    const before = this.#last
    const list = this.#list()
    if (this.#last === before) return
    this.emit('change', list)
    for (const phone of this.#options.hub.phones) {
      this.#told.add(phone.id)
      this.#options.hub.send(phone.id, { type: 'monitors', monitors: list })
    }
  }
}
