import { describe, expect, it } from 'vitest'
import {
  encode,
  MAX_FRAME_BYTES,
  type PcMessage,
  type PhoneMessage,
  parsePcMessage,
  parsePhoneMessage,
} from './messages.ts'
import { generateDeviceKey, generatePairingToken, type PairingCode } from './pairing.ts'

const hello = (
  auth: Extract<PhoneMessage, { type: 'hello' }>['auth'] = {
    kind: 'token',
    token: generatePairingToken(),
  },
): Extract<PhoneMessage, { type: 'hello' }> => ({
  type: 'hello',
  protocol: 2,
  auth,
  device: {
    name: 'Pixel 9',
    viewport: { width: 800, height: 360 },
    devicePixelRatio: 3,
    touch: true,
  },
})

describe('phone messages', () => {
  it('round-trips every message type', () => {
    const messages: PhoneMessage[] = [
      hello(),
      hello({ kind: 'code', code: '012345' as PairingCode }),
      hello({ kind: 'key', deviceId: crypto.randomUUID(), key: generateDeviceKey() }),
      { type: 'stream.request', size: { width: 1440, height: 1080 }, quality: 'auto' },
      {
        type: 'stream.request',
        size: { width: 1680, height: 1080 },
        quality: 'full',
        device: { viewport: { width: 800, height: 360 }, devicePixelRatio: 3 },
      },
      {
        type: 'stream.request',
        size: { width: 1080, height: 1440 },
        quality: 'full',
        source: { kind: 'virtual' },
      },
      {
        type: 'stream.request',
        size: { width: 1080, height: 1440 },
        quality: 'full',
        source: { kind: 'mirror', displayId: '2528732444' },
      },
      { type: 'stream.stop' },
      { type: 'widgets.subscribe', widgets: ['pc-stats', 'media'] },
      { type: 'widgets.subscribe', widgets: [] },
      { type: 'media.control', action: 'play-pause' },
      { type: 'rtc.signal', session: 1, signal: { kind: 'answer', sdp: 'v=0' } },
      {
        type: 'rtc.signal',
        session: 1,
        signal: { kind: 'candidate', candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
      },
      { type: 'ping', at: 1 },
    ]
    for (const message of messages) {
      expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
    }
  })

  it('rejects a hello with a short token, a bad code or a short key', () => {
    for (const auth of [
      { kind: 'token', token: 'abc' },
      { kind: 'code', code: '12345' },
      { kind: 'code', code: '12345a' },
      { kind: 'key', deviceId: crypto.randomUUID(), key: 'abc' },
      { kind: 'key', deviceId: 'x', key: generateDeviceKey() },
      { kind: 'password', password: 'hunter2' },
    ]) {
      expect(parsePhoneMessage(JSON.stringify({ ...hello(), auth })).ok, auth.kind).toBe(false)
    }
    const { auth: _, ...missing } = hello()
    expect(parsePhoneMessage(JSON.stringify(missing)).ok).toBe(false)
  })

  it('rejects a protocol mismatch', () => {
    expect(parsePhoneMessage(JSON.stringify({ ...hello(), protocol: 1 })).ok).toBe(false)
  })

  it('rejects unknown types, PC-only types and non-integer sizes', () => {
    expect(parsePhoneMessage('{"type":"shell.exec","cmd":"calc"}').ok).toBe(false)
    expect(parsePhoneMessage('{"type":"welcome"}').ok).toBe(false)
    expect(
      parsePhoneMessage(
        '{"type":"stream.request","size":{"width":1440.5,"height":1080},"quality":"full"}',
      ).ok,
    ).toBe(false)
  })

  describe('stream.request device', () => {
    const request = (device: unknown) =>
      JSON.stringify({
        type: 'stream.request',
        size: { width: 1680, height: 1080 },
        quality: 'full',
        device,
      })

    it('keeps the viewport and pixel ratio it was sent with', () => {
      const device = { viewport: { width: 892, height: 412 }, devicePixelRatio: 2.625 }
      const parsed = parsePhoneMessage(request(device))
      expect(
        parsed.ok && parsed.message.type === 'stream.request' && parsed.message.device,
      ).toEqual(device)
    })

    it('is optional, so a phone that leaves it out is still understood', () => {
      const frame = JSON.stringify({
        type: 'stream.request',
        size: { width: 1680, height: 1080 },
        quality: 'full',
      })
      expect(parsePhoneMessage(frame).ok).toBe(true)
    })

    it('rejects a viewport or pixel ratio the layout code could not have produced', () => {
      const viewport = { width: 892, height: 412 }
      const bad = [
        { viewport, devicePixelRatio: 0 },
        { viewport, devicePixelRatio: 9 },
        { viewport: { width: 0, height: 412 }, devicePixelRatio: 2 },
        { viewport: { width: 892.5, height: 412 }, devicePixelRatio: 2 },
        { viewport: { width: 20_000, height: 412 }, devicePixelRatio: 2 },
        { viewport },
        { devicePixelRatio: 2 },
        'landscape',
      ]
      for (const device of bad) {
        expect(parsePhoneMessage(request(device)).ok, JSON.stringify(device)).toBe(false)
      }
    })
  })

  it('rejects garbage and oversized frames without throwing', () => {
    expect(parsePhoneMessage('not json')).toEqual({ ok: false, error: 'frame is not JSON' })
    expect(parsePhoneMessage('x'.repeat(MAX_FRAME_BYTES + 1))).toEqual({
      ok: false,
      error: 'frame too large',
    })
  })
})

describe('rtc.signal', () => {
  const answer = { kind: 'answer', sdp: 'v=0\r\n' }
  const offer = { kind: 'offer', sdp: 'v=0\r\n' }
  const candidate = {
    kind: 'candidate',
    candidate: 'candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  }
  const frame = (signal: unknown, session: unknown = 3) =>
    JSON.stringify({ type: 'rtc.signal', session, signal })

  it('lets the PC send an offer and the phone send an answer, and both send candidates', () => {
    expect(parsePcMessage(frame(offer)).ok).toBe(true)
    expect(parsePcMessage(frame(candidate)).ok).toBe(true)
    expect(parsePhoneMessage(frame(answer)).ok).toBe(true)
    expect(parsePhoneMessage(frame(candidate)).ok).toBe(true)
  })

  it('keeps the session number and the signal it was sent with', () => {
    const parsed = parsePcMessage(frame(offer, 7))
    expect(parsed).toEqual({ ok: true, message: { type: 'rtc.signal', session: 7, signal: offer } })
  })

  it('does not accept the wrong side sending an offer or an answer', () => {
    expect(parsePhoneMessage(frame(offer)).ok).toBe(false)
    expect(parsePcMessage(frame(answer)).ok).toBe(false)
  })

  it('accepts the end-of-candidates marker and candidates without a media section', () => {
    const end = { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null }
    expect(parsePcMessage(frame(end)).ok).toBe(true)
    expect(parsePhoneMessage(frame(end)).ok).toBe(true)
  })

  it('rejects a signal without a session, or with one that is not a whole non-negative number', () => {
    for (const session of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parsePhoneMessage(frame(answer, session)).ok, String(session)).toBe(false)
    }
    expect(parsePhoneMessage(JSON.stringify({ type: 'rtc.signal', signal: answer })).ok).toBe(false)
    expect(parsePhoneMessage(frame(answer, 0)).ok).toBe(true)
  })

  it('rejects empty, oversized and unknown descriptions', () => {
    expect(parsePcMessage(frame({ kind: 'offer', sdp: '' })).ok).toBe(false)
    expect(parsePcMessage(frame({ kind: 'offer', sdp: 'v'.repeat(64 * 1024 + 1) })).ok).toBe(false)
    expect(parsePcMessage(frame({ kind: 'rollback', sdp: 'v=0' })).ok).toBe(false)
    expect(parsePhoneMessage(frame({ kind: 'answer' })).ok).toBe(false)
  })

  it('rejects candidates that are too long or point at an impossible media section', () => {
    expect(parsePhoneMessage(frame({ ...candidate, candidate: 'c'.repeat(4097) })).ok).toBe(false)
    expect(parsePhoneMessage(frame({ ...candidate, sdpMLineIndex: -1 })).ok).toBe(false)
    expect(parsePhoneMessage(frame({ ...candidate, sdpMid: 5 })).ok).toBe(false)
  })
})

describe('stream.ready', () => {
  it('carries the size of the video that is flowing', () => {
    const message = { type: 'stream.ready', size: { width: 1680, height: 1080 } } as const
    expect(parsePcMessage(encode(message))).toEqual({ ok: true, message })
    expect(parsePcMessage('{"type":"stream.ready","size":{"width":0,"height":1080}}').ok).toBe(
      false,
    )
  })
})

describe('PC messages', () => {
  it('accepts widget updates carrying any JSON', () => {
    const frame = encode({
      type: 'widget.update',
      instanceId: 'gh-1',
      widgetId: 'github-stats',
      data: { followers: 12, repos: [{ name: 'shiftpane', stars: 3 }], ok: true, missing: null },
      at: Date.now(),
    })
    expect(parsePcMessage(frame).ok).toBe(true)
  })

  it('rejects phone-only messages', () => {
    expect(parsePcMessage(encode(hello())).ok).toBe(false)
  })

  it('welcomes a phone with or without a new pairing for it to save', () => {
    const welcome: PcMessage = {
      type: 'welcome',
      protocol: 2,
      sessionId: 's1',
      pc: { name: 'desk', platform: 'windows' },
      features: { display: true, remoteControl: false },
    }
    expect(parsePcMessage(encode(welcome))).toEqual({ ok: true, message: welcome })
    const paired = {
      ...welcome,
      pairing: { deviceId: crypto.randomUUID(), key: generateDeviceKey() },
    }
    expect(parsePcMessage(encode(paired))).toEqual({ ok: true, message: paired })
    const weak = { ...welcome, pairing: { deviceId: crypto.randomUUID(), key: 'abc' } }
    expect(parsePcMessage(JSON.stringify(weak)).ok).toBe(false)
  })

  it('sets a phone to one of the splits it offers, by name', () => {
    for (const split of ['monitor', '70-30', '50-50', 'widgets'] as const) {
      const message: PcMessage = { type: 'split.set', split }
      expect(parsePcMessage(encode(message))).toEqual({ ok: true, message })
    }
    // Names only: a share of the screen, a made-up preset or a missing split is refused.
    for (const split of [0.5, '0.5', '60-40', 'WIDGETS', '', null, undefined]) {
      expect(parsePcMessage(JSON.stringify({ type: 'split.set', split })).ok, String(split)).toBe(
        false,
      )
    }
  })

  it('does not take a split from a phone', () => {
    expect(parsePhoneMessage(JSON.stringify({ type: 'split.set', split: 'widgets' })).ok).toBe(
      false,
    )
  })

  it('lists the monitors the phone can duplicate', () => {
    const message: PcMessage = {
      type: 'monitors',
      monitors: [
        { id: '2528732444', name: 'Mi Monitor', width: 1920, height: 1080, primary: true },
        { id: '1', name: '', width: 2560, height: 1440, primary: false },
      ],
    }
    expect(parsePcMessage(encode(message))).toEqual({ ok: true, message })
    expect(parsePcMessage(encode({ type: 'monitors', monitors: [] })).ok).toBe(true)
  })

  it('rejects a monitor whose id could be anything but an id', () => {
    for (const id of ['', '../x', 'a b', 'x'.repeat(33)]) {
      const frame = JSON.stringify({
        type: 'monitors',
        monitors: [{ id, name: 'x', width: 1920, height: 1080, primary: true }],
      })
      expect(parsePcMessage(frame).ok, id).toBe(false)
    }
  })
})

describe('monitor source, widgets and media', () => {
  const request = (source: unknown) =>
    JSON.stringify({
      type: 'stream.request',
      size: { width: 1080, height: 1440 },
      quality: 'full',
      source,
    })

  it('treats a request without a source as the virtual monitor', () => {
    const parsed = parsePhoneMessage(
      '{"type":"stream.request","size":{"width":1080,"height":1440},"quality":"full"}',
    )
    expect(parsed.ok && parsed.message.type === 'stream.request' && parsed.message.source).toBe(
      undefined,
    )
  })

  it('rejects a mirror source without a usable display id', () => {
    for (const source of [
      { kind: 'mirror' },
      { kind: 'mirror', displayId: '' },
      { kind: 'mirror', displayId: 'C:\\x' },
      { kind: 'mirror', displayId: 5 },
      { kind: 'window', displayId: '1' },
    ]) {
      expect(parsePhoneMessage(request(source)).ok, JSON.stringify(source)).toBe(false)
    }
  })

  it('accepts only widget ids and only a bounded list of them', () => {
    const subscribe = (widgets: unknown) => JSON.stringify({ type: 'widgets.subscribe', widgets })
    expect(parsePhoneMessage(subscribe(['pc-stats'])).ok).toBe(true)
    expect(parsePhoneMessage(subscribe(['PC-Stats'])).ok).toBe(false)
    expect(parsePhoneMessage(subscribe(['../etc'])).ok).toBe(false)
    expect(parsePhoneMessage(subscribe(Array.from({ length: 33 }, (_, i) => `w${i}`))).ok).toBe(
      false,
    )
  })

  it('accepts only the three media buttons', () => {
    const control = (action: unknown) => JSON.stringify({ type: 'media.control', action })
    for (const action of ['play-pause', 'next', 'previous']) {
      expect(parsePhoneMessage(control(action)).ok, action).toBe(true)
    }
    for (const action of ['stop', 'volume-up', 'open calc', '']) {
      expect(parsePhoneMessage(control(action)).ok, action).toBe(false)
    }
  })
})
