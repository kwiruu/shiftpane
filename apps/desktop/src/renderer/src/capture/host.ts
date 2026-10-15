import { CaptureCommand, type CaptureEvent } from '../../../shared/capture.ts'

/** The most frames per second sent to the phone. */
export const MAX_FRAME_RATE = 30
/** Plenty for a 1080p desktop at 30 fps on a LAN, and it keeps bursts small. */
export const MAX_BITRATE = 12_000_000
/** Lets the window paint before the warm-up connection blocks the page while it is built. */
const WARM_UP_DELAY_MS = 500
/** How often the sender is asked whether encoded frames are going out yet. */
const WATCH_INTERVAL_MS = 200

/** `window.shiftpane.capture`. */
export interface CaptureChannel {
  /** Commands arrive unvalidated; the host parses each one. */
  onCommand(listener: (command: unknown) => void): () => void
  send(event: CaptureEvent): void
}

export interface CaptureHostDependencies {
  channel: CaptureChannel
  /**
   * Opens and drops a throwaway connection shortly after start, so the first real offer does
   * not also pay for Chromium's one-time WebRTC start-up, which can take a second or two. It
   * runs after a short delay because it blocks the page while it constructs.
   */
  warmUp?: boolean
  /** Resolves with the display the main process armed; rejects when it did not. */
  getDisplayMedia(options: DisplayMediaStreamOptions): Promise<MediaStream>
  createPeerConnection(configuration: RTCConfiguration): RTCPeerConnection
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  log?: (message: string) => void
}

interface Running {
  session: number
  peer: RTCPeerConnection
  sender: RTCRtpSender
  stream: MediaStream
  /** Candidates from the phone that arrived before its answer was applied. */
  queued: RTCIceCandidateInit[]
  answered: boolean
  /** `framesEncoded` before the current track started, so only new frames count as "flowing". */
  baseline: number
  watcher: unknown
}

const captureOptions: DisplayMediaStreamOptions = {
  video: { frameRate: { ideal: MAX_FRAME_RATE, max: MAX_FRAME_RATE } },
  audio: false,
}

/**
 * Captures the virtual monitor and sends it to one phone over WebRTC.
 *
 * The main process decides which display (it arms the source `getDisplayMedia` returns), when
 * to start and stop, and relays the signaling; this page owns the media: the capture, the
 * peer connection and the encoder. One session at a time, because there is one monitor.
 *
 * Returns a function that stops everything and detaches from the channel.
 */
export function startCaptureHost(deps: CaptureHostDependencies): () => void {
  const log = deps.log ?? (() => {})
  const startTimer = deps.setInterval ?? ((callback, ms) => globalThis.setInterval(callback, ms))
  const stopTimer =
    deps.clearInterval ??
    ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>))

  let current: Running | null = null
  // Commands run one after another, so an answer cannot overtake the offer it answers.
  let queue: Promise<void> = Promise.resolve()

  const send = (event: CaptureEvent) => deps.channel.send(event)

  function close(): void {
    const running = current
    if (!running) return
    current = null
    stopTimer(running.watcher)
    for (const track of running.stream.getTracks()) track.stop()
    running.peer.onicecandidate = null
    running.peer.onconnectionstatechange = null
    running.peer.close()
  }

  function fail(session: number, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    log(`session ${session} failed: ${detail}`)
    if (current?.session === session) close()
    send({
      type: 'failed',
      session,
      message: `Capturing the monitor failed: ${detail}`.slice(0, 512),
    })
  }

  /** Reports `flowing` as soon as the sender has encoded a frame of the current track. */
  function watch(running: Running): void {
    stopTimer(running.watcher)
    let checking = false
    running.watcher = startTimer(() => {
      if (checking || current !== running) return
      checking = true
      running.peer
        .getStats(running.sender.track)
        .then((stats) => {
          if (current !== running) return
          for (const report of stats.values()) {
            if (report.type !== 'outbound-rtp' || report.kind !== 'video') continue
            const encoded = Number(report.framesEncoded ?? 0)
            if (encoded <= running.baseline) continue
            const settings = running.sender.track?.getSettings() ?? {}
            const width = Number(report.frameWidth ?? settings.width ?? 0)
            const height = Number(report.frameHeight ?? settings.height ?? 0)
            if (width <= 0 || height <= 0) continue
            stopTimer(running.watcher)
            running.baseline = encoded
            log(`session ${running.session}: frames flowing at ${width}x${height}`)
            send({ type: 'flowing', session: running.session, size: { width, height } })
            return
          }
        })
        .catch((error: unknown) => log(`stats failed: ${String(error)}`))
        .finally(() => {
          checking = false
        })
    }, WATCH_INTERVAL_MS)
  }

  async function start(session: number): Promise<void> {
    close()
    const began = Date.now()
    const stream = await deps.getDisplayMedia(captureOptions)
    log(`session ${session}: screen captured after ${Date.now() - began} ms`)
    const [track] = stream.getVideoTracks()
    if (!track) {
      for (const leftover of stream.getTracks()) leftover.stop()
      throw new Error('the capture produced no video')
    }
    // LAN only: no STUN or TURN, host candidates are all that is needed.
    const peer = deps.createPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })
    const transceiver = peer.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: [{ maxFramerate: MAX_FRAME_RATE, maxBitrate: MAX_BITRATE }],
    })
    const running: Running = {
      session,
      peer,
      sender: transceiver.sender,
      stream,
      queued: [],
      answered: false,
      baseline: 0,
      watcher: null,
    }
    current = running

    peer.onicecandidate = ({ candidate }) => {
      if (current !== running) return
      send({
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
      if (current !== running) return
      log(`session ${session}: connection ${peer.connectionState}`)
      if (peer.connectionState === 'failed')
        fail(session, new Error('the phone could not be reached'))
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    const sdp = peer.localDescription?.sdp ?? offer.sdp ?? ''
    if (current !== running) return
    send({ type: 'rtc.signal', session, signal: { kind: 'offer', sdp } })
    log(`session ${session}: offer sent after ${Date.now() - began} ms`)
    watch(running)
  }

  async function recapture(session: number): Promise<void> {
    const running = current
    if (!running || running.session !== session) return
    const stream = await deps.getDisplayMedia(captureOptions)
    const [track] = stream.getVideoTracks()
    if (!track) {
      for (const leftover of stream.getTracks()) leftover.stop()
      throw new Error('the capture produced no video')
    }
    if (current !== running) {
      for (const leftover of stream.getTracks()) leftover.stop()
      return
    }
    // Frames already encoded from the old track do not count towards "flowing".
    running.baseline = await encodedFrames(running)
    await running.sender.replaceTrack(track)
    for (const old of running.stream.getTracks()) old.stop()
    running.stream = stream
    watch(running)
  }

  async function encodedFrames(running: Running): Promise<number> {
    const stats = await running.peer.getStats(running.sender.track)
    let frames = 0
    for (const report of stats.values()) {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        frames = Math.max(frames, Number(report.framesEncoded ?? 0))
      }
    }
    return frames
  }

  async function signal(command: Extract<CaptureCommand, { type: 'rtc.signal' }>): Promise<void> {
    const running = current
    if (!running || running.session !== command.session) return
    const { signal: description } = command
    if (description.kind === 'answer') {
      await running.peer.setRemoteDescription({ type: 'answer', sdp: description.sdp })
      running.answered = true
      const queued = running.queued.splice(0)
      for (const candidate of queued) await addCandidate(running, candidate)
      return
    }
    // The empty candidate only marks the phone's last one; there is nothing to add.
    if (description.candidate === '') return
    const candidate: RTCIceCandidateInit = {
      candidate: description.candidate,
      sdpMid: description.sdpMid,
      sdpMLineIndex: description.sdpMLineIndex,
    }
    if (running.answered) await addCandidate(running, candidate)
    else running.queued.push(candidate)
  }

  async function addCandidate(running: Running, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await running.peer.addIceCandidate(candidate)
    } catch (error) {
      // A candidate for a network the PC cannot use is not a reason to give up.
      log(`candidate ignored: ${String(error)}`)
    }
  }

  async function run(command: CaptureCommand): Promise<void> {
    switch (command.type) {
      case 'start':
        return start(command.session)
      case 'recapture':
        return recapture(command.session)
      case 'stop':
        if (current?.session === command.session) close()
        return
      case 'rtc.signal':
        return signal(command)
    }
  }

  const warmUpTimer = deps.warmUp
    ? globalThis.setTimeout(() => {
        try {
          const began = Date.now()
          const warm = deps.createPeerConnection({ iceServers: [] })
          warm.createDataChannel('warm-up')
          void warm
            .createOffer()
            .then((offer) => warm.setLocalDescription(offer))
            .then(() => log(`warm-up done in ${Date.now() - began} ms`))
            .catch(() => {})
          globalThis.setTimeout(() => warm.close(), 5_000)
        } catch (error) {
          log(`warm-up skipped: ${String(error)}`)
        }
      }, WARM_UP_DELAY_MS)
    : undefined

  const unsubscribe = deps.channel.onCommand((raw) => {
    const parsed = CaptureCommand.safeParse(raw)
    if (!parsed.success) {
      log('ignored an invalid capture command')
      return
    }
    const command = parsed.data
    queue = queue.then(() => run(command)).catch((error: unknown) => fail(command.session, error))
  })

  return () => {
    globalThis.clearTimeout(warmUpTimer)
    unsubscribe()
    close()
  }
}
