import { describe, expect, it } from 'vitest'
import {
  encode,
  MAX_FRAME_BYTES,
  type PhoneMessage,
  parsePcMessage,
  parsePhoneMessage,
} from './messages.ts'
import { generatePairingToken } from './pairing.ts'

const hello = (): Extract<PhoneMessage, { type: 'hello' }> => ({
  type: 'hello',
  protocol: 1,
  token: generatePairingToken(),
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
      { type: 'stream.request', size: { width: 1440, height: 1080 }, quality: 'auto' },
      { type: 'stream.stop' },
      { type: 'rtc.signal', signal: { kind: 'answer', sdp: 'v=0' } },
      {
        type: 'rtc.signal',
        signal: { kind: 'candidate', candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
      },
      { type: 'ping', at: 1 },
    ]
    for (const message of messages) {
      expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
    }
  })

  it('rejects a hello with a short or missing token', () => {
    const bad = { ...hello(), token: 'abc' }
    expect(parsePhoneMessage(JSON.stringify(bad)).ok).toBe(false)
    const { token: _, ...missing } = hello()
    expect(parsePhoneMessage(JSON.stringify(missing)).ok).toBe(false)
  })

  it('rejects a protocol mismatch', () => {
    expect(parsePhoneMessage(JSON.stringify({ ...hello(), protocol: 2 })).ok).toBe(false)
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

  it('rejects garbage and oversized frames without throwing', () => {
    expect(parsePhoneMessage('not json')).toEqual({ ok: false, error: 'frame is not JSON' })
    expect(parsePhoneMessage('x'.repeat(MAX_FRAME_BYTES + 1))).toEqual({
      ok: false,
      error: 'frame too large',
    })
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
})
