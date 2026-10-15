import { describe, expect, it } from 'vitest'
import type { CaptureEvent } from '../../../shared/capture.ts'
import { MAX_BITRATE, MAX_FRAME_RATE, startCaptureHost } from './host.ts'

class FakeTrack {
  stopped = false
  readonly size: { width: number; height: number }

  constructor(size = { width: 800, height: 600 }) {
    this.size = size
  }

  stop() {
    this.stopped = true
  }
  getSettings() {
    return this.size
  }
}

class FakeStream {
  readonly track: FakeTrack

  constructor(track: FakeTrack) {
    this.track = track
  }

  getVideoTracks() {
    return [this.track]
  }
  getTracks() {
    return [this.track]
  }
}

class FakePeer {
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  localDescription: { sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  readonly candidates: RTCIceCandidateInit[] = []
  closed = false
  /** What the encoder reports; tests raise it to simulate frames going out. */
  framesEncoded = 0
  frameSize = { width: 800, height: 600 }
  readonly order: string[] = []
  transceiverInit: unknown = null
  readonly sender: { track: FakeTrack | null; replaceTrack(track: FakeTrack): Promise<void> } = {
    track: null,
    replaceTrack: async (track) => {
      this.sender.track = track
      this.order.push('replaceTrack')
    },
  }

  readonly configuration: unknown

  constructor(configuration: unknown) {
    this.configuration = configuration
  }

  addTransceiver(track: FakeTrack, init: unknown) {
    this.sender.track = track
    this.transceiverInit = init
    return { sender: this.sender }
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' }
  }
  async setLocalDescription(description: { sdp: string }) {
    this.localDescription = description
  }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.order.push('setRemoteDescription')
    this.remoteDescription = description
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.order.push('addIceCandidate')
    this.candidates.push(candidate)
  }
  async getStats() {
    return new Map<string, Record<string, unknown>>([
      [
        'out',
        {
          type: 'outbound-rtp',
          kind: 'video',
          framesEncoded: this.framesEncoded,
          frameWidth: this.frameSize.width,
          frameHeight: this.frameSize.height,
        },
      ],
    ])
  }
  close() {
    this.closed = true
  }
}

function setup(options: { capture?: () => Promise<FakeStream> } = {}) {
  const events: CaptureEvent[] = []
  const logs: string[] = []
  const peers: FakePeer[] = []
  const streams: FakeStream[] = []
  const captureCalls: unknown[] = []
  let listener: ((command: unknown) => void) | null = null
  let unsubscribed = false
  let tick: (() => void) | null = null
  let timersCleared = 0

  const dispose = startCaptureHost({
    channel: {
      onCommand: (l) => {
        listener = l
        return () => {
          unsubscribed = true
        }
      },
      send: (event) => events.push(event),
    },
    getDisplayMedia: async (constraints) => {
      captureCalls.push(constraints)
      const stream = await (options.capture?.() ?? Promise.resolve(new FakeStream(new FakeTrack())))
      streams.push(stream)
      return stream as unknown as MediaStream
    },
    createPeerConnection: (configuration) => {
      const peer = new FakePeer(configuration)
      peers.push(peer)
      return peer as unknown as RTCPeerConnection
    },
    setInterval: (callback) => {
      tick = callback
      return 'timer'
    },
    clearInterval: () => {
      timersCleared += 1
    },
    log: (message) => logs.push(message),
  })

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  return {
    events,
    logs,
    peers,
    streams,
    captureCalls,
    dispose,
    get unsubscribed() {
      return unsubscribed
    },
    get timersCleared() {
      return timersCleared
    },
    command: async (command: unknown) => {
      listener?.(command)
      await settle()
    },
    tick: async () => {
      tick?.()
      await settle()
    },
  }
}

const answer = (session: number) => ({
  type: 'rtc.signal',
  session,
  signal: { kind: 'answer', sdp: 'v=0 answer' },
})
const remoteCandidate = (
  session: number,
  candidate = 'candidate:1 1 udp 1 192.168.1.5 5000 typ host',
) => ({
  type: 'rtc.signal',
  session,
  signal: { kind: 'candidate', candidate, sdpMid: '0', sdpMLineIndex: 0 },
})

describe('startCaptureHost', () => {
  it('captures the armed display and offers its video, capped at 30 fps and on a LAN', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 4 })

    expect(t.captureCalls).toEqual([
      { video: { frameRate: { ideal: MAX_FRAME_RATE, max: MAX_FRAME_RATE } }, audio: false },
    ])
    expect(MAX_FRAME_RATE).toBe(30)
    const [peer] = t.peers
    expect(peer?.configuration).toMatchObject({ iceServers: [] })
    expect(peer?.transceiverInit).toMatchObject({
      direction: 'sendonly',
      sendEncodings: [{ maxFramerate: MAX_FRAME_RATE, maxBitrate: MAX_BITRATE }],
    })
    expect(t.events).toEqual([
      { type: 'rtc.signal', session: 4, signal: { kind: 'offer', sdp: 'v=0 offer' } },
    ])
  })

  it('relays its candidates, and the end-of-candidates marker as an empty one', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    const peer = t.peers[0]
    peer?.onicecandidate?.({
      candidate: {
        candidate: 'candidate:1 1 udp 1 192.168.1.20 6000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    })
    peer?.onicecandidate?.({ candidate: null })
    expect(t.events.slice(1)).toEqual([
      {
        type: 'rtc.signal',
        session: 1,
        signal: {
          kind: 'candidate',
          candidate: 'candidate:1 1 udp 1 192.168.1.20 6000 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
      {
        type: 'rtc.signal',
        session: 1,
        signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null },
      },
    ])
  })

  it("applies the phone's answer, holding its candidates until then", async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    await t.command(remoteCandidate(1, 'candidate:early 1 udp 1 192.168.1.5 5000 typ host'))
    const peer = t.peers[0]
    expect(peer?.candidates).toEqual([])

    await t.command(answer(1))
    expect(peer?.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' })
    expect(peer?.candidates.map((c) => c.candidate)).toEqual([
      'candidate:early 1 udp 1 192.168.1.5 5000 typ host',
    ])

    await t.command(remoteCandidate(1, 'candidate:late 1 udp 1 192.168.1.5 5001 typ host'))
    expect(peer?.candidates).toHaveLength(2)
    expect(peer?.order).toEqual(['setRemoteDescription', 'addIceCandidate', 'addIceCandidate'])
  })

  it('ignores the phone end-of-candidates marker and a candidate the connection rejects', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    await t.command(answer(1))
    const peer = t.peers[0] as FakePeer
    await t.command({
      type: 'rtc.signal',
      session: 1,
      signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null },
    })
    expect(peer.candidates).toEqual([])

    peer.addIceCandidate = async () => {
      throw new Error('bad candidate')
    }
    await t.command(remoteCandidate(1))
    expect(t.events.some((event) => event.type === 'failed')).toBe(false)
  })

  it('says video is flowing once a frame was encoded, and only once', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 2 })
    await t.tick()
    expect(t.events.some((event) => event.type === 'flowing')).toBe(false)

    const peer = t.peers[0] as FakePeer
    peer.framesEncoded = 1
    peer.frameSize = { width: 1680, height: 1080 }
    await t.tick()
    expect(t.events.at(-1)).toEqual({
      type: 'flowing',
      session: 2,
      size: { width: 1680, height: 1080 },
    })
    expect(t.timersCleared).toBeGreaterThan(0)
  })

  it('swaps the captured track when the monitor is resized, and reports the new size', async () => {
    const tracks = [new FakeTrack(), new FakeTrack({ width: 1680, height: 1080 })]
    const t = setup({ capture: async () => new FakeStream(tracks.shift() as FakeTrack) })
    await t.command({ type: 'start', session: 1 })
    const peer = t.peers[0] as FakePeer
    peer.framesEncoded = 5
    await t.tick()
    const readyBefore = t.events.filter((event) => event.type === 'flowing').length

    await t.command({ type: 'recapture', session: 1 })
    expect(peer.order).toContain('replaceTrack')
    expect(t.peers).toHaveLength(1)
    expect(t.streams[0]?.track.stopped).toBe(true)
    expect(t.streams[1]?.track.stopped).toBe(false)
    // Frames of the old display do not count.
    await t.tick()
    expect(t.events.filter((event) => event.type === 'flowing')).toHaveLength(readyBefore)

    peer.framesEncoded = 6
    peer.frameSize = { width: 1680, height: 1080 }
    await t.tick()
    expect(t.events.at(-1)).toEqual({
      type: 'flowing',
      session: 1,
      size: { width: 1680, height: 1080 },
    })
  })

  it('stops capturing and closes the connection on stop', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    await t.command({ type: 'stop', session: 1 })
    expect(t.peers[0]?.closed).toBe(true)
    expect(t.streams[0]?.track.stopped).toBe(true)
  })

  it('ignores commands for a session that is not the current one', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 3 })
    await t.command({ type: 'stop', session: 2 })
    await t.command(answer(2))
    await t.command({ type: 'recapture', session: 2 })
    expect(t.peers[0]?.closed).toBe(false)
    expect(t.peers[0]?.remoteDescription).toBeNull()
    expect(t.captureCalls).toHaveLength(1)
  })

  it('closes the previous connection when a new session starts', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    await t.command({ type: 'start', session: 2 })
    expect(t.peers).toHaveLength(2)
    expect(t.peers[0]?.closed).toBe(true)
    expect(t.peers[1]?.closed).toBe(false)
    await t.command(answer(1))
    expect(t.peers[1]?.remoteDescription).toBeNull()
  })

  it('reports a capture that was refused', async () => {
    const t = setup({
      capture: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      },
    })
    await t.command({ type: 'start', session: 1 })
    expect(t.events).toEqual([
      { type: 'failed', session: 1, message: 'Capturing the monitor failed: Permission denied' },
    ])
    expect(t.peers).toHaveLength(0)
  })

  it('reports a connection that failed, and closes it', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    const peer = t.peers[0] as FakePeer
    peer.connectionState = 'failed'
    peer.onconnectionstatechange?.()
    expect(t.events.at(-1)).toMatchObject({ type: 'failed', session: 1 })
    expect(peer.closed).toBe(true)
  })

  it('ignores malformed commands and does not trust their shape', async () => {
    const t = setup()
    await t.command({ type: 'start' })
    await t.command({ type: 'shell.exec', cmd: 'calc' })
    await t.command('start')
    await t.command(null)
    expect(t.peers).toHaveLength(0)
    expect(t.captureCalls).toHaveLength(0)
    expect(t.logs.filter((line) => line.includes('invalid'))).toHaveLength(4)
  })

  it('stops everything when disposed', async () => {
    const t = setup()
    await t.command({ type: 'start', session: 1 })
    t.dispose()
    expect(t.unsubscribed).toBe(true)
    expect(t.peers[0]?.closed).toBe(true)
  })
})
