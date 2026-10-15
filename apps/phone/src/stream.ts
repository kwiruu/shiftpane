import type { PcMessage, PhoneMessage } from '@shiftpane/protocol'

/** What the monitor area shows: the video when there is one, otherwise why not. */
export interface StreamState {
  /** `connecting` from the PC's offer until video arrives; `failed` carries `message`. */
  phase: 'idle' | 'connecting' | 'failed'
  stream: MediaStream | null
  /** Physical pixels of the video as the PC reports it; null until the first `stream.ready`. */
  size: { width: number; height: number } | null
  message: string | null
}

const IDLE: StreamState = { phase: 'idle', stream: null, size: null, message: null }

export interface StreamReceiverOptions {
  /** Sends a protocol message to the PC; false when the socket is not connected. */
  send(message: PhoneMessage): boolean
  createPeerConnection(configuration: RTCConfiguration): RTCPeerConnection
  log?: (message: string) => void
}

interface Negotiation {
  session: number
  peer: RTCPeerConnection
  /** Candidates that arrived before the offer was applied. */
  queued: RTCIceCandidateInit[]
  ready: boolean
}

/**
 * Receives the PC's video: answers the PC's offer, trades ICE candidates and exposes the
 * resulting `MediaStream`. The PC sends the stream; this side never asks for one except through
 * `stream.request`.
 *
 * One negotiation at a time. Every offer starts over with a fresh `RTCPeerConnection`, and
 * anything still arriving for an earlier offer's session number is dropped. When the socket
 * drops, `reset()` closes everything: the PC forgets this phone too, and offers again after the
 * phone reconnects and asks for its monitor.
 */
export class StreamReceiver {
  readonly #options: StreamReceiverOptions
  readonly #listeners = new Set<() => void>()
  #state: StreamState = IDLE
  #current: Negotiation | null = null

  constructor(options: StreamReceiverOptions) {
    this.#options = options
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getState = (): StreamState => this.#state

  /** Feed every message from the PC through here. */
  handle(message: PcMessage): void {
    switch (message.type) {
      case 'rtc.signal':
        if (message.signal.kind === 'offer') {
          void this.#offer(message.session, message.signal.sdp)
        } else {
          void this.#candidate(message.session, message.signal)
        }
        return
      case 'stream.ready':
        if (this.#current) this.#set({ ...this.#state, size: message.size })
        return
      case 'error':
        if (message.code === 'display-unavailable') {
          this.#close()
          this.#set({ phase: 'failed', stream: null, size: null, message: message.message })
        }
        return
      default:
        return
    }
  }

  /**
   * Opens and drops a throwaway connection, so the browser's one-time network discovery is not
   * paid for by the first offer, which the user is waiting on.
   */
  warmUp(): void {
    try {
      const began = Date.now()
      const warm = this.#options.createPeerConnection({ iceServers: [] })
      this.#options.log?.(`warm-up: connection created in ${Date.now() - began} ms`)
      warm.createDataChannel('warm-up')
      void warm
        .createOffer()
        .then((offer) => warm.setLocalDescription(offer))
        .then(() => this.#options.log?.(`warm-up: offer ready in ${Date.now() - began} ms`))
        .catch(() => {})
      setTimeout(() => warm.close(), 5_000)
    } catch {
      // Not worth failing for; the first real offer just takes longer.
    }
  }

  /** The connection to the PC was lost. */
  reset(): void {
    if (this.#current === null && this.#state === IDLE) return
    this.#close()
    this.#set(IDLE)
  }

  async #offer(session: number, sdp: string): Promise<void> {
    this.#close()
    // LAN only: host candidates, no STUN or TURN.
    const peer = this.#options.createPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })
    const negotiation: Negotiation = { session, peer, queued: [], ready: false }
    this.#current = negotiation
    this.#set({ phase: 'connecting', stream: null, size: null, message: null })

    peer.ontrack = ({ track, streams, receiver }) => {
      if (this.#current !== negotiation || track.kind !== 'video') return
      lowLatency(receiver)
      const stream = streams[0] ?? new MediaStream([track])
      this.#set({ ...this.#state, stream })
    }
    peer.onicecandidate = ({ candidate }) => {
      if (this.#current !== negotiation) return
      this.#options.send({
        type: 'rtc.signal',
        session,
        signal: {
          kind: 'candidate',
          candidate: candidate?.candidate ?? '',
          sdpMid: candidate?.sdpMid ?? null,
          sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
        },
      })
    }
    peer.onconnectionstatechange = () => {
      if (this.#current !== negotiation) return
      this.#options.log?.(`connection ${peer.connectionState}`)
      if (peer.connectionState === 'failed') this.#fail('The video connection to the PC was lost.')
    }

    try {
      await peer.setRemoteDescription({ type: 'offer', sdp })
      if (this.#current !== negotiation) return
      negotiation.ready = true
      for (const candidate of negotiation.queued.splice(0))
        await addCandidate(negotiation, candidate)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      if (this.#current !== negotiation) return
      this.#options.send({
        type: 'rtc.signal',
        session,
        signal: { kind: 'answer', sdp: peer.localDescription?.sdp ?? answer.sdp ?? '' },
      })
    } catch (error) {
      if (this.#current !== negotiation) return
      this.#options.log?.(`negotiation failed: ${String(error)}`)
      this.#fail('Could not set up the video connection.')
    }
  }

  async #candidate(
    session: number,
    signal: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null },
  ): Promise<void> {
    const negotiation = this.#current
    if (!negotiation || negotiation.session !== session) return
    // The empty candidate only marks the PC's last one; there is nothing to add.
    if (signal.candidate === '') return
    const candidate: RTCIceCandidateInit = {
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex,
    }
    if (negotiation.ready) await addCandidate(negotiation, candidate)
    else negotiation.queued.push(candidate)
  }

  #fail(message: string): void {
    this.#close()
    this.#set({ phase: 'failed', stream: null, size: null, message })
  }

  #close(): void {
    const negotiation = this.#current
    if (!negotiation) return
    this.#current = null
    negotiation.peer.ontrack = null
    negotiation.peer.onicecandidate = null
    negotiation.peer.onconnectionstatechange = null
    negotiation.peer.close()
  }

  #set(state: StreamState): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}

async function addCandidate(negotiation: Negotiation, candidate: RTCIceCandidateInit) {
  try {
    await negotiation.peer.addIceCandidate(candidate)
  } catch {
    // A candidate for a network this phone cannot use is not a reason to give up.
  }
}

/** Asks the browser to hold as little video back as it can; browsers without it ignore this. */
function lowLatency(receiver: RTCRtpReceiver): void {
  const tunable = receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number | null
    playoutDelayHint?: number | null
  }
  try {
    if ('jitterBufferTarget' in tunable) tunable.jitterBufferTarget = 0
    if ('playoutDelayHint' in tunable) tunable.playoutDelayHint = 0
  } catch {
    // Refused values leave the default in place.
  }
}
