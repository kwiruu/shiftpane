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
  log?: (message: string) => void
}

interface Active {
  phoneId: string
  session: number
}

/**
 * Streams the virtual monitor to the phone that owns it.
 *
 * The display controller says where the monitor is (`attached`) and when it is gone
 * (`detached`); this turns that into one capture page session per phone: capture and offer
 * when the monitor appears, swap the captured source when it is resized, stop when it goes
 * away or the phone leaves, and relay the WebRTC signaling both ways.
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

  constructor(options: StreamManagerOptions) {
    this.#options = options
    this.#log = options.log ?? (() => {})
    const { display, hub, bridge } = options

    const onAttached = (event: { phoneId: string; display: DisplayInfo }) =>
      void this.#attached(event.phoneId, event.display)
    const onDetached = (event: { phoneId: string }) => this.#phoneGone(event.phoneId)
    const onChange = (phones: PhoneInfo[]) => {
      const present = new Set(phones.map((phone) => phone.id))
      const gone = [this.#active?.phoneId, this.#pending?.phoneId].filter(
        (id): id is string => id !== undefined && !present.has(id),
      )
      for (const id of gone) this.#phoneGone(id)
    }
    const onMessage = (phone: PhoneInfo, message: PhoneMessage) => {
      if (message.type === 'rtc.signal') this.#fromPhone(phone, message)
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

    const active = this.#active
    if (active?.phoneId === phoneId) {
      this.#options.bridge.send({ type: 'recapture', session: active.session })
      return
    }
    // The monitor changed hands: the previous phone's stream ends here.
    this.#endSession()
    const session = this.#nextSession++
    this.#active = { phoneId, session }
    this.#log(`streaming to ${phoneId} (session ${session})`)
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
