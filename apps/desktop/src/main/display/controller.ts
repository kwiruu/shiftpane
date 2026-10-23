import { EventEmitter } from 'node:events'
import type { DisplayInfo, DisplaySize } from '@shiftpane/helper-client'
import { pickMonitorSize } from '@shiftpane/layout'
import type { DisplayState, MonitorSize } from '../../shared/display.ts'
import type { HelperSession } from './helper-host.ts'
import { describeProblem, type Problem } from './problems.ts'
import { catalogueSizes } from './sizes.ts'

/** What the controller needs from {@link HelperHost}. */
export interface DisplayHost {
  session(): Promise<HelperSession>
  stop(): Promise<void>
  on(event: 'exit', listener: () => void): unknown
}

/** What the phone's screen looks like at one moment. */
export interface PhoneScreen {
  /** CSS pixels. */
  viewport: { width: number; height: number }
  devicePixelRatio: number
}

export interface PairedPhone extends PhoneScreen {
  id: string
}

export interface DisplayControllerOptions {
  host: DisplayHost
  /** Refresh rate asked for; the driver picks the closest it offers. */
  refreshHz?: number
  /**
   * Every size to have the driver list, prepared in one go when a phone pairs. By default the
   * fixed catalogue, the same for every phone.
   */
  sizesFor?: (viewport: PhoneScreen['viewport'], devicePixelRatio: number) => DisplaySize[]
  /**
   * The size to put the monitor at for the size a phone's split asks for. By default the nearest
   * catalogue size, which the phone letterboxes.
   */
  pickSize?: (wanted: MonitorSize) => MonitorSize
  /**
   * The OS scale, in percent, to give the monitor for a phone with this device pixel ratio, or
   * undefined to leave the scale the OS has for it. Sent only when the backend can scale.
   */
  scaleFor?: (devicePixelRatio: number) => number | undefined
  /** How long `stop` waits for in-flight work before closing the helper anyway. */
  stopGraceMs?: number
  log?: (message: string) => void
}

export interface DisplayControllerEvents {
  change: [DisplayState]
  /** The virtual monitor is on the desktop at `display`'s size, for this phone. */
  attached: [{ phoneId: string; display: DisplayInfo }]
  /** The monitor was removed or handed to another phone. */
  detached: [{ phoneId: string }]
  /** This phone asked for a monitor that could not be provided. */
  failed: [{ phoneId: string; problem: Problem }]
  /** Another phone asked for the monitor, which only one phone can have at a time. */
  preempted: [{ phoneId: string; by: string }]
}

interface Want {
  phoneId: string
  size: MonitorSize
  /** The OS scale in percent; undefined leaves the OS's own. */
  scale?: number
}

interface Have extends Want {
  display: DisplayInfo
}

type Job =
  | { kind: 'prepare'; phoneId: string; sizes: DisplaySize[] }
  | { kind: 'attach'; want: Want }
  | { kind: 'detach' }

const sameSize = (a: MonitorSize, b: MonitorSize) => a.width === b.width && a.height === b.height
const sameMonitor = (a: Want, b: Want) => sameSize(a.size, b.size) && a.scale === b.scale
const keyOf = (size: MonitorSize) => `${size.width}x${size.height}`

/**
 * Makes the virtual monitor follow the phone.
 *
 * Callers say what they want (`streamRequested`, `streamStopped`, `phoneLeft`); the
 * controller records it and works the helper towards it one call at a time. Requests that
 * arrive while the helper is busy, for example behind a UAC prompt, are collapsed so that only
 * the latest wanted size is applied, and a failed attempt is not repeated until something
 * changes or the user presses retry.
 *
 * There is one virtual monitor, so one phone owns it: the last phone to ask. When that phone
 * stops, disconnects or the app quits, the monitor is detached.
 */
export class DisplayController extends EventEmitter<DisplayControllerEvents> {
  readonly #host: DisplayHost
  readonly #refreshHz: number
  readonly #sizesFor: NonNullable<DisplayControllerOptions['sizesFor']>
  readonly #pickSize: NonNullable<DisplayControllerOptions['pickSize']>
  readonly #scaleFor: NonNullable<DisplayControllerOptions['scaleFor']>
  readonly #stopGraceMs: number
  readonly #log: (message: string) => void

  #state: DisplayState = { status: 'unknown' }
  #available = false
  /** Whether the backend can set the monitor's OS scale. */
  #scaling = false
  readonly #phones = new Set<string>()
  /** Each paired phone's device pixel ratio, for its monitor's scale. */
  readonly #ratios = new Map<string, number>()
  #prepares: Array<{ phoneId: string; sizes: DisplaySize[] }> = []
  /** Prepares that did not complete (declined prompt, driver missing), kept for a retry. */
  #unprepared: Array<{ phoneId: string; sizes: DisplaySize[] }> = []
  /** Sizes the driver is known to offer (`keyOf`), from prepares that completed. */
  readonly #prepared = new Set<string>()
  #desired: Want | null = null
  #applied: Have | null = null
  /** A helper call failed; hold off until the wanted state changes or the user retries. */
  #blocked = false
  #draining = false
  #done: Promise<void> = Promise.resolve()
  #stopped = false

  constructor(options: DisplayControllerOptions) {
    super()
    this.#host = options.host
    this.#refreshHz = options.refreshHz ?? 60
    this.#sizesFor = options.sizesFor ?? (() => catalogueSizes())
    this.#pickSize = options.pickSize ?? pickMonitorSize
    this.#scaleFor = options.scaleFor ?? (() => undefined)
    this.#stopGraceMs = options.stopGraceMs ?? 4_000
    this.#log = options.log ?? (() => {})
    this.#host.on('exit', () => this.#onHelperExit())
  }

  get state(): DisplayState {
    return this.#state
  }

  /** Whether a virtual monitor can be created right now: what the phone is told in `welcome`. */
  get available(): boolean {
    return this.#available
  }

  /** Starts the helper and reports whether its backend is ready. Never throws. */
  async start(): Promise<void> {
    await this.#probe()
  }

  /**
   * Looks at the backend again without touching the monitor, e.g. when the window regains
   * focus after the user installed the driver.
   */
  async recheck(): Promise<void> {
    if (this.#stopped || this.#state.status === 'working') return
    await this.#probe()
    if (!this.#available) return
    this.#requeueUnprepared()
    await this.#pump()
  }

  /** The "Try again" button: re-probe the backend, then repeat whatever last failed. */
  async retry(): Promise<void> {
    if (this.#stopped) return
    this.#blocked = false
    await this.#probe()
    this.#requeueUnprepared()
    await this.#pump()
  }

  /** A phone finished pairing. Prepares every size it may ask for, behind at most one prompt. */
  phoneJoined(phone: PairedPhone): void {
    if (this.#stopped) return
    this.#phones.add(phone.id)
    this.#ratios.set(phone.id, phone.devicePixelRatio)
    const sizes = this.#sizesFor(phone.viewport, phone.devicePixelRatio)
    if (this.#queuePrepare(phone.id, sizes)) void this.#pump()
  }

  phoneLeft(phoneId: string): void {
    this.#phones.delete(phoneId)
    this.#ratios.delete(phoneId)
    this.#prepares = this.#prepares.filter((job) => job.phoneId !== phoneId)
    this.#unprepared = this.#unprepared.filter((job) => job.phoneId !== phoneId)
    if (this.#desired?.phoneId === phoneId) {
      this.#desired = null
      this.#blocked = false
    }
    void this.#pump()
  }

  /**
   * The phone's split needs a monitor area of `size` physical pixels.
   *
   * The monitor is put at the nearest size of the fixed catalogue, not at `size` itself, and the
   * phone letterboxes the video. With a fixed catalogue the driver's list does not change after
   * the first prepare, so a rotation or a new split never restarts the driver.
   *
   * `screen` is the phone's viewport as it is now; it only matters when a custom `sizesFor`
   * derives sizes from it.
   */
  streamRequested(phoneId: string, size: MonitorSize, screen?: PhoneScreen): void {
    if (this.#stopped || !this.#phones.has(phoneId)) return
    const wanted = this.#pickSize({ width: size.width, height: size.height })
    if (screen) {
      this.#ratios.set(phoneId, screen.devicePixelRatio)
      const sizes = this.#sizesFor(screen.viewport, screen.devicePixelRatio)
      this.#queuePrepare(phoneId, [wanted, ...sizes])
    }
    const previous = this.#desired
    this.#desired = {
      phoneId,
      size: { width: wanted.width, height: wanted.height },
      scale: this.#scaleOf(phoneId),
    }
    this.#blocked = false
    if (previous && previous.phoneId !== phoneId) {
      this.emit('preempted', { phoneId: previous.phoneId, by: phoneId })
    }
    void this.#pump()
  }

  /** The scale setting changed: the monitor takes the new scale now, if one is up. */
  rescale(): void {
    if (this.#stopped || !this.#desired) return
    this.#desired = { ...this.#desired, scale: this.#scaleOf(this.#desired.phoneId) }
    this.#blocked = false
    void this.#pump()
  }

  /** The phone no longer wants a monitor (it chose the widgets-only split). */
  streamStopped(phoneId: string): void {
    if (this.#desired?.phoneId !== phoneId) return
    this.#desired = null
    this.#blocked = false
    void this.#pump()
  }

  /** Removes the monitor and shuts the helper down. Safe to call twice. */
  async stop(): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    this.#desired = null
    this.#prepares = []
    this.#unprepared = []
    this.#blocked = false
    const settled = this.#pump()
    let timer: ReturnType<typeof setTimeout> | undefined
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.#stopGraceMs)
    })
    await Promise.race([settled, grace])
    clearTimeout(timer)
    // Closing the helper's stdin makes it detach on its own if the call above never ran.
    await this.#host.stop()
  }

  // ---------------------------------------------------------------------------------------

  /** Runs the work queue if it is not already running; resolves when it has gone idle. */
  #pump(): Promise<void> {
    if (!this.#draining) {
      this.#draining = true
      this.#done = this.#drain()
    }
    return this.#done
  }

  #requeueUnprepared(): void {
    this.#prepares.push(...this.#unprepared.filter((job) => this.#phones.has(job.phoneId)))
    this.#unprepared = []
  }

  /**
   * Queues a prepare for the sizes in `sizes` that the driver does not have and no pending
   * prepare covers, so the same viewport arriving again costs no helper call. Returns whether
   * anything was queued.
   *
   * A size whose prepare failed counts as covered: asking again is the retry button's job, and
   * the attach still adds the one size it needs.
   */
  #queuePrepare(phoneId: string, sizes: DisplaySize[]): boolean {
    const jobs = [...this.#prepares, ...this.#unprepared]
    const covered = (key: string) =>
      this.#prepared.has(key) || jobs.some((job) => job.sizes.some((size) => keyOf(size) === key))

    const missing = new Map<string, DisplaySize>()
    for (const { width, height } of sizes) {
      const key = keyOf({ width, height })
      if (!covered(key)) missing.set(key, { width, height })
    }
    if (missing.size === 0) return false
    this.#prepares.push({ phoneId, sizes: [...missing.values()] })
    return true
  }

  async #drain(): Promise<void> {
    try {
      for (;;) {
        const job = this.#nextJob()
        if (!job) return
        await this.#run(job)
      }
    } finally {
      // Runs in the same turn as the `return` above, so a request cannot slip in between
      // "nothing left to do" and "no longer draining".
      this.#draining = false
    }
  }

  #nextJob(): Job | null {
    const prepare = this.#prepares.shift()
    if (prepare) return { kind: 'prepare', ...prepare }
    if (this.#blocked) return null

    const want = this.#desired
    const have = this.#applied
    if (want) {
      if (have && sameMonitor(have, want)) {
        // The right size is already there; only the owner changes.
        if (have.phoneId !== want.phoneId) {
          this.#applied = { ...have, phoneId: want.phoneId }
          this.#settle()
          this.emit('detached', { phoneId: have.phoneId })
          this.emit('attached', { phoneId: want.phoneId, display: have.display })
        }
        return null
      }
      return { kind: 'attach', want }
    }
    return have ? { kind: 'detach' } : null
  }

  async #run(job: Job): Promise<void> {
    switch (job.kind) {
      case 'prepare':
        return this.#prepare(job)
      case 'attach':
        return this.#attach(job.want)
      case 'detach':
        return this.#detach()
    }
  }

  async #prepare(job: { phoneId: string; sizes: DisplaySize[] }): Promise<void> {
    const { sizes } = job
    // Until it succeeds, a retry will run it again.
    this.#unprepared.push(job)
    this.#setState({ status: 'working', size: null })
    try {
      const { channel } = await this.#host.session()
      const ready = await this.#readBackend(channel)
      if (!ready) return
      const result = await channel.call('display.prepare', { sizes })
      this.#unprepared = this.#unprepared.filter((pending) => pending !== job)
      for (const size of sizes) this.#prepared.add(keyOf(size))
      this.#log(`prepared ${sizes.length} sizes, ${result.added} added`)
      // Adding sizes restarts the driver, which can take a monitor that is on the desktop
      // with it. Forget it so the next step puts the wanted size back.
      if (result.added > 0 && this.#applied) {
        const lost = this.#applied
        this.#applied = null
        this.emit('detached', { phoneId: lost.phoneId })
      }
      this.#settle()
    } catch (error) {
      const problem = describeProblem(error, null)
      this.#setProblem(problem, null)
      // A phone is waiting on a size this prepare was meant to add. The attach that would follow
      // asks Windows for the same approval straight after it was declined, so wait for the phone
      // to ask again, or for "Try again", instead.
      const want = this.#desired
      if (want && !this.#prepared.has(keyOf(want.size))) {
        this.#blocked = true
        this.emit('failed', { phoneId: want.phoneId, problem })
      }
    }
  }

  async #attach(want: Want): Promise<void> {
    this.#setState({ status: 'working', size: want.size })
    try {
      const { channel } = await this.#host.session()
      const result = await channel.call('display.attach', {
        width: want.size.width,
        height: want.size.height,
        refreshHz: this.#refreshHz,
        ...(want.scale === undefined ? {} : { scalePercent: want.scale }),
      })
      const previous = this.#applied
      this.#applied = { ...want, display: result.display }
      this.#available = true
      this.#settle()
      if (previous && previous.phoneId !== want.phoneId) {
        this.emit('detached', { phoneId: previous.phoneId })
      }
      this.emit('attached', { phoneId: want.phoneId, display: result.display })
    } catch (error) {
      this.#blocked = true
      const problem = describeProblem(error, want.size)
      this.#setProblem(problem, want.size)
      this.emit('failed', { phoneId: want.phoneId, problem })
    }
  }

  async #detach(): Promise<void> {
    try {
      const { channel } = await this.#host.session()
      await channel.call('display.detach')
      const old = this.#applied
      this.#applied = null
      this.#settle()
      if (old) this.emit('detached', { phoneId: old.phoneId })
    } catch (error) {
      this.#blocked = true
      this.#setProblem(describeProblem(error, null), null)
    }
  }

  /** Starts the helper if needed and asks it for a fresh `helper.hello`. */
  async #probe(): Promise<void> {
    try {
      const { channel } = await this.#host.session()
      if (await this.#readBackend(channel)) this.#settle()
    } catch (error) {
      this.#available = false
      this.#setProblem(describeProblem(error, null), null)
    }
  }

  /** The scale for this phone's monitor, when the backend can set one. */
  #scaleOf(phoneId: string): number | undefined {
    const ratio = this.#ratios.get(phoneId)
    return this.#scaling && ratio !== undefined ? this.#scaleFor(ratio) : undefined
  }

  /** Records whether the backend is ready; when it is not, shows why. */
  async #readBackend(channel: HelperSession['channel']): Promise<boolean> {
    const { backend } = await channel.call('helper.hello')
    this.#available = backend.ready && backend.capabilities.virtualDisplay
    this.#scaling = backend.capabilities.scaling
    if (this.#available) return true
    // A driver that was removed and put back starts from its default sizes.
    this.#prepared.clear()
    const message = backend.reason ?? `The ${backend.name} display backend is not ready.`
    this.#setProblem(
      { reason: backend.name === 'vdd' ? 'driver-missing' : 'unsupported', message },
      null,
    )
    return false
  }

  #onHelperExit(): void {
    if (this.#stopped) return
    const lost = this.#applied
    this.#applied = null
    this.#blocked = true
    if (lost) this.emit('detached', { phoneId: lost.phoneId })
    this.#setProblem(
      {
        reason: 'helper-failed',
        message:
          'The display helper stopped unexpectedly. The virtual monitor was removed; choose the split again to bring it back.',
      },
      null,
    )
  }

  /** The state when nothing is wrong and no call is running. */
  #settle(): void {
    const have = this.#applied
    this.#setState(
      have ? { status: 'attached', phoneId: have.phoneId, size: sizeOf(have) } : { status: 'idle' },
    )
  }

  #setProblem(problem: Problem, size: MonitorSize | null): void {
    this.#log(`${problem.reason}: ${problem.message}`)
    this.#setState({ status: 'problem', reason: problem.reason, message: problem.message, size })
  }

  #setState(state: DisplayState): void {
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return
    this.#state = state
    this.emit('change', state)
  }
}

/** The size Windows really applied, which is what the phone will see. */
function sizeOf(have: Have): MonitorSize {
  return { width: have.display.width, height: have.display.height }
}
