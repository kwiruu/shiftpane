import type { DisplayInfo } from '@shiftpane/helper-client'
import type { PhoneMessage } from '@shiftpane/protocol'
import type { CaptureCommand, CaptureEvent } from '../../shared/capture.ts'
import type { DisplayController } from '../display/controller.ts'
import type { PhoneHub, PhoneInfo } from '../server/phone-hub.ts'
import { resolveMdnsCandidate } from './candidate.ts'

/** The capture page, as the manager sees it. */
export interface CaptureBridge {
  send(command: CaptureCommand): void
  onEvent(listener: (event: CaptureEvent) => void): () => void
}

export interface StreamManagerOptions {
  display: Pick<DisplayController, 'on' | 'off'>
  hub: Pick<PhoneHub, 'on' | 'off' | 'send'>
  bridge: CaptureBridge
  /**
   * Finds the capture source of the virtual monitor and lets the capture page take it.
   * Rejects with a message fit for the phone's user when the monitor cannot be captured.
   */
  arm(display: DisplayInfo): Promise<void>
  /**
   * Finds the capture source of one of the PC's real monitors (Electron's `Display.id`) and
   * lets the capture page take it. Without it, phones cannot duplicate a monitor.
   */
  armMirror?(displayId: string): Promise<void>
  log?: (message: string) => void
}

type Source = { kind: 'virtual' } | { kind: 'mirror'; displayId: string }

interface Active {
  phoneId: string
  session: number
  source: Source
}

/**
 * Streams a monitor to the phone that asked for it: the virtual monitor, or a copy of one of
 * the PC's real monitors.
 *
 * For the virtual monitor, the display controller says where it is (`attached`) and when it is
 * gone (`detached`). For a copy, the phone's `stream.request` names the monitor. Either way this
 * runs one capture page session per phone: capture and offer when the monitor is ready, swap the
 * captured source when it changes (a resize, or switching between virtual and a copy), stop when
 * it goes away or the phone leaves, and relay the WebRTC signaling both ways.
 *
 * `stream.ready` is sent here, once frames are flowing, which is what it means.
 */
export class StreamManager {
  readonly #options: StreamManagerOptions
  readonly #log: (message: string) => void
  readonly #unhook: Array<() => void> = []
  #active: Active | null = null
  /** The phone whose capture source is being looked up, and which lookup is current. */
  #pending: { phoneId: string; generation: number } | null = null
  #generation = 0
  #nextSession = 1
  /** Phones that asked for a copy of a real monitor, and which one. */
  readonly #mirrors = new Map<string, string>()

  constructor(options: StreamManagerOptions) {
    this.#options = options
    this.#log = options.log ?? (() => {})
    const { display, hub, bridge } = options

    const onAttached = (event: { phoneId: string; display: DisplayInfo }) => {
      // A virtual monitor that finished attaching after its phone switched to a copy.
      if (this.#mirrors.has(event.phoneId)) return
      void this.#attached(event.phoneId, event.display)
    }
    const onDetached = (event: { phoneId: string }) => {
      // Switching to a copy removes the virtual monitor; that must not end the copy's stream.
      if (this.#mirrors.has(event.phoneId)) return
      this.#phoneGone(event.phoneId)
    }
    const onChange = (phones: PhoneInfo[]) => {
      const present = new Set(phones.map((phone) => phone.id))
      const gone = [this.#active?.phoneId, this.#pending?.phoneId, ...this.#mirrors.keys()].filter(
        (id): id is string => id !== undefined && !present.has(id),
      )
      for (const id of new Set(gone)) {
        this.#mirrors.delete(id)
        this.#phoneGone(id)
      }
    }
    const onMessage = (phone: PhoneInfo, message: PhoneMessage) => {
      switch (message.type) {
        case 'rtc.signal':
          this.#fromPhone(phone, message)
          return
        case 'stream.request':
          if (message.source?.kind === 'mirror')
            this.#wantMirror(phone.id, message.source.displayId)
          else this.#wantVirtual(phone.id)
          return
        case 'stream.stop':
          this.#mirrors.delete(phone.id)
          if (this.#active?.phoneId === phone.id && this.#active.source.kind === 'mirror') {
            this.#endSession()
          }
          return
        default:
          return
      }
    }

    display.on('attached', onAttached)
    display.on('detached', onDetached)
    hub.on('change', onChange)
    hub.on('message', onMessage)
    this.#unhook.push(
      () => display.off('attached', onAttached),
      () => display.off('detached', onDetached),
      () => hub.off('change', onChange),
      () => hub.off('message', onMessage),
      bridge.onEvent((event) => this.#fromCapture(event)),
    )
  }

  /** Stops capturing and lets go of the controller, the hub and the capture page. */
  stop(): void {
    this.#generation += 1
    this.#pending = null
    this.#mirrors.clear()
    this.#endSession()
    for (const unhook of this.#unhook.splice(0)) unhook()
  }

  async #attached(phoneId: string, display: DisplayInfo): Promise<void> {
    const generation = ++this.#generation
    this.#pending = { phoneId, generation }
    try {
      await this.#options.arm(display)
    } catch (error) {
      if (this.#superseded(generation)) return
      this.#pending = null
      this.#fail(phoneId, error instanceof Error ? error.message : String(error))
      return
    }
    if (this.#superseded(generation)) return
    this.#pending = null
    this.#begin(phoneId, { kind: 'virtual' })
  }

  #wantMirror(phoneId: string, displayId: string): void {
    const already = this.#active
    const unchanged =
      this.#mirrors.get(phoneId) === displayId &&
      already?.phoneId === phoneId &&
      already.source.kind === 'mirror' &&
      already.source.displayId === displayId
    this.#mirrors.set(phoneId, displayId)
    // The phone repeats its request on every split change; a copy does not change with it.
    if (unchanged) return
    void this.#mirror(phoneId, displayId)
  }

  /** The phone went back to the virtual monitor, whose `attached` event starts its stream. */
  #wantVirtual(phoneId: string): void {
    if (!this.#mirrors.delete(phoneId)) return
    if (this.#pending?.phoneId === phoneId) {
      this.#generation += 1
      this.#pending = null
    }
    if (this.#active?.phoneId === phoneId && this.#active.source.kind === 'mirror') {
      this.#endSession()
    }
  }

  async #mirror(phoneId: string, displayId: string): Promise<void> {
    const arm = this.#options.armMirror
    if (!arm) {
      this.#fail(phoneId, 'This PC cannot duplicate its monitors.')
      return
    }
    const generation = ++this.#generation
    this.#pending = { phoneId, generation }
    try {
      await arm(displayId)
    } catch (error) {
      if (this.#superseded(generation)) return
      this.#pending = null
      this.#fail(phoneId, error instanceof Error ? error.message : String(error))
      return
    }
    if (this.#superseded(generation) || this.#mirrors.get(phoneId) !== displayId) return
    this.#pending = null
    this.#begin(phoneId, { kind: 'mirror', displayId })
  }

  /** Captures the armed source for `phoneId`: in its running session, or in a new one. */
  #begin(phoneId: string, source: Source): void {
    const active = this.#active
    if (active?.phoneId === phoneId) {
      this.#active = { ...active, source }
      this.#options.bridge.send({ type: 'recapture', session: active.session })
      return
    }
    // The monitor changed hands: the previous phone's stream ends here.
    this.#endSession()
    const session = this.#nextSession++
    this.#active = { phoneId, session, source }
    const what =
      source.kind === 'mirror' ? `a copy of display ${source.displayId}` : 'the virtual monitor'
    this.#log(`streaming ${what} to ${phoneId} (session ${session})`)
    this.#options.bridge.send({ type: 'start', session })
  }

  #superseded(generation: number): boolean {
    return this.#pending?.generation !== generation
  }

  /** The monitor was removed from under this phone, or the phone disconnected. */
  #phoneGone(phoneId: string): void {
    if (this.#pending?.phoneId === phoneId) {
      this.#generation += 1
      this.#pending = null
    }
    if (this.#active?.phoneId === phoneId) this.#endSession()
  }

  #endSession(): void {
    const active = this.#active
    if (!active) return
    this.#active = null
    this.#options.bridge.send({ type: 'stop', session: active.session })
  }

  #fail(phoneId: string, message: string): void {
    this.#log(`stream for ${phoneId} failed: ${message}`)
    this.#options.hub.send(phoneId, {
      type: 'error',
      code: 'display-unavailable',
      message: message.slice(0, 1024),
    })
  }

  #fromPhone(phone: PhoneInfo, message: Extract<PhoneMessage, { type: 'rtc.signal' }>): void {
    const active = this.#active
    if (!active || active.phoneId !== phone.id || active.session !== message.session) return
    const { signal } = message
    if (signal.kind === 'candidate') {
      const candidate = resolveMdnsCandidate(signal.candidate, phone.address)
      if (candidate !== signal.candidate) {
        this.#log(`phone candidate ${signal.candidate.split(' ')[4]} -> ${phone.address}`)
      }
      this.#options.bridge.send({ ...message, signal: { ...signal, candidate } })
      return
    }
    this.#options.bridge.send(message)
  }

  #fromCapture(event: CaptureEvent): void {
    const active = this.#active
    if (!active || active.session !== event.session) return
    switch (event.type) {
      case 'rtc.signal':
        this.#options.hub.send(active.phoneId, event)
        return
      case 'flowing':
        this.#options.hub.send(active.phoneId, { type: 'stream.ready', size: event.size })
        return
      case 'failed':
        this.#endSession()
        this.#fail(active.phoneId, event.message)
        return
    }
  }
}
