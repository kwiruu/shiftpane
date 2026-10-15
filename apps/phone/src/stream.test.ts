import type { PcMessage, PhoneMessage } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { StreamReceiver } from './stream.ts'

class FakeReceiver {
  jitterBufferTarget: number | null = null
}

class FakePeer {
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  localDescription: { sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  readonly candidates: RTCIceCandidateInit[] = []
  readonly order: string[] = []
  closed = false
  failSetRemote = false
  readonly configuration: unknown

  constructor(configuration: unknown) {
    this.configuration = configuration
  }

  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.order.push('setRemoteDescription')
    if (this.failSetRemote) throw new Error('bad sdp')
    this.remoteDescription = description
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' }
  }
  async setLocalDescription(description: { sdp: string }) {
    this.order.push('setLocalDescription')
    this.localDescription = description
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.order.push('addIceCandidate')
    this.candidates.push(candidate)
  }
  close() {
    this.closed = true
  }
}

function setup(options: { failSetRemote?: boolean } = {}) {
  const sent: PhoneMessage[] = []
  const peers: FakePeer[] = []
  let connected = true
  const receiver = new StreamReceiver({
    send: (message) => {
      if (!connected) return false
      sent.push(message)
      return true
    },
    createPeerConnection: (configuration) => {
      const peer = new FakePeer(configuration)
      peer.failSetRemote = options.failSetRemote ?? false
      peers.push(peer)
      return peer as unknown as RTCPeerConnection
    },
  })
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  return {
    receiver,
    sent,
    peers,
    disconnect: () => {
      connected = false
    },
    handle: async (message: PcMessage) => {
      receiver.handle(message)
      await settle()
    },
  }
}

const offer = (session: number): PcMessage => ({
  type: 'rtc.signal',
  session,
  signal: { kind: 'offer', sdp: 'v=0 offer' },
})
const candidate = (
  session: number,
  text = 'candidate:1 1 udp 1 192.168.1.20 6000 typ host',
): PcMessage => ({
  type: 'rtc.signal',
  session,
  signal: { kind: 'candidate', candidate: text, sdpMid: '0', sdpMLineIndex: 0 },
})

describe('StreamReceiver', () => {
  it('answers the PC offer with the same session number, on a LAN', async () => {
    const t = setup()
    await t.handle(offer(5))
    expect(t.peers[0]?.configuration).toMatchObject({ iceServers: [] })
    expect(t.peers[0]?.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 offer' })
    expect(t.sent).toEqual([
      { type: 'rtc.signal', session: 5, signal: { kind: 'answer', sdp: 'v=0 answer' } },
    ])
    expect(t.receiver.getState()).toMatchObject({ phase: 'connecting', stream: null })
  })

  it('sends its candidates with the session, and an empty one when gathering ends', async () => {
    const t = setup()
    await t.handle(offer(2))
    t.sent.length = 0
    const peer = t.peers[0]
    peer?.onicecandidate?.({
      candidate: {
        candidate: 'candidate:9 1 udp 1 abc.local 5000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    })
    peer?.onicecandidate?.({ candidate: null })
    expect(t.sent).toEqual([
      {
        type: 'rtc.signal',
        session: 2,
        signal: {
          kind: 'candidate',
          candidate: 'candidate:9 1 udp 1 abc.local 5000 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
      {
        type: 'rtc.signal',
        session: 2,
        signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null },
      },
    ])
  })

  it('adds the PC candidates, and ignores its end-of-candidates marker', async () => {
    const t = setup()
    await t.handle(offer(1))
    await t.handle(candidate(1))
    await t.handle(candidate(1, ''))
    expect(t.peers[0]?.candidates).toEqual([
      {
        candidate: 'candidate:1 1 udp 1 192.168.1.20 6000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    ])
  })

  it('holds candidates that arrive before the offer has been applied', async () => {
    const t = setup()
    t.receiver.handle(offer(1))
    t.receiver.handle(candidate(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(t.peers[0]?.order.slice(0, 2)).toEqual(['setRemoteDescription', 'addIceCandidate'])
  })

  it('drops candidates for a session that is not current', async () => {
    const t = setup()
    await t.handle(candidate(1))
    await t.handle(offer(2))
    await t.handle(candidate(1))
    expect(t.peers[0]?.candidates).toEqual([])
  })

  it('shows the stream when the track arrives and the size when the PC says ready', async () => {
    const t = setup()
    await t.handle(offer(1))
    const stream = { id: 'monitor' }
    const receiver = new FakeReceiver()
    t.peers[0]?.ontrack?.({ track: { kind: 'video' }, streams: [stream], receiver })
    expect(t.receiver.getState().stream).toBe(stream)
    expect(receiver.jitterBufferTarget).toBe(0)

    await t.handle({ type: 'stream.ready', size: { width: 1680, height: 1080 } })
    expect(t.receiver.getState()).toMatchObject({ size: { width: 1680, height: 1080 } })
  })

  it('ignores an audio track', async () => {
    const t = setup()
    await t.handle(offer(1))
    t.peers[0]?.ontrack?.({ track: { kind: 'audio' }, streams: [{}], receiver: new FakeReceiver() })
    expect(t.receiver.getState().stream).toBeNull()
  })

  it('starts over on a new offer, so a resized or restarted stream replaces the old one', async () => {
    const t = setup()
    await t.handle(offer(1))
    t.peers[0]?.ontrack?.({ track: { kind: 'video' }, streams: [{}], receiver: new FakeReceiver() })
    await t.handle(offer(2))
    expect(t.peers[0]?.closed).toBe(true)
    expect(t.peers[1]?.closed).toBe(false)
    expect(t.receiver.getState()).toMatchObject({ phase: 'connecting', stream: null })
    expect(t.sent.at(-1)).toMatchObject({ session: 2, signal: { kind: 'answer' } })
  })

  it('does not answer an offer that was replaced while it was being applied', async () => {
    const t = setup()
    t.receiver.handle(offer(1))
    t.receiver.handle(offer(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const answers = t.sent.filter(
      (m) => m.type === 'rtc.signal' && m.signal.kind === 'answer',
    ) as Array<Extract<PhoneMessage, { type: 'rtc.signal' }>>
    expect(answers.map((m) => m.session)).toEqual([2])
  })

  it('goes back to idle and closes the connection when the socket drops', async () => {
    const t = setup()
    await t.handle(offer(1))
    t.peers[0]?.ontrack?.({ track: { kind: 'video' }, streams: [{}], receiver: new FakeReceiver() })
    t.receiver.reset()
    expect(t.peers[0]?.closed).toBe(true)
    expect(t.receiver.getState()).toEqual({
      phase: 'idle',
      stream: null,
      size: null,
      message: null,
    })
  })

  it('negotiates again from scratch after a reconnect', async () => {
    const t = setup()
    await t.handle(offer(1))
    t.receiver.reset()
    await t.handle(offer(1))
    expect(t.peers).toHaveLength(2)
    expect(t.peers[1]?.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 offer' })
  })

  it('reports a connection that failed', async () => {
    const t = setup()
    await t.handle(offer(1))
    const peer = t.peers[0] as FakePeer
    peer.connectionState = 'failed'
    peer.onconnectionstatechange?.()
    expect(t.receiver.getState()).toMatchObject({ phase: 'failed' })
    expect(peer.closed).toBe(true)
  })

  it('reports an offer it could not apply, and sends no answer', async () => {
    const t = setup({ failSetRemote: true })
    await t.handle(offer(1))
    expect(t.receiver.getState()).toMatchObject({ phase: 'failed' })
    expect(t.sent).toEqual([])
    expect(t.peers[0]?.closed).toBe(true)
  })

  it('shows the PC reason when the monitor cannot be streamed', async () => {
    const t = setup()
    await t.handle(offer(1))
    await t.handle({
      type: 'error',
      code: 'display-unavailable',
      message: 'Another phone is using the PC monitor.',
    })
    expect(t.receiver.getState()).toEqual({
      phase: 'failed',
      stream: null,
      size: null,
      message: 'Another phone is using the PC monitor.',
    })
    expect(t.peers[0]?.closed).toBe(true)
  })

  it('does not treat other errors as the stream failing', async () => {
    const t = setup()
    await t.handle(offer(1))
    await t.handle({ type: 'error', code: 'bad-message', message: 'nope' })
    expect(t.receiver.getState().phase).toBe('connecting')
  })

  it('notifies subscribers on every change', async () => {
    const t = setup()
    let calls = 0
    const unsubscribe = t.receiver.subscribe(() => {
      calls += 1
    })
    await t.handle(offer(1))
    const afterOffer = calls
    expect(afterOffer).toBeGreaterThan(0)
    unsubscribe()
    t.receiver.reset()
    expect(calls).toBe(afterOffer)
  })
})
