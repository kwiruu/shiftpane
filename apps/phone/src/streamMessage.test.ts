import { computeSplit, SPLIT_PRESETS } from '@shiftpane/layout'
import { encode, parsePhoneMessage } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { streamMessageFor } from './streamMessage.ts'

const screen = { width: 800, height: 360, devicePixelRatio: 3 }

describe('streamMessageFor', () => {
  it('asks for the monitor size the split computed, in a message the PC accepts', () => {
    const { stream } = computeSplit({
      viewport: screen,
      devicePixelRatio: screen.devicePixelRatio,
      monitorFraction: SPLIT_PRESETS['70-30'],
    })
    const message = streamMessageFor(stream, screen)
    expect(message).toEqual({
      type: 'stream.request',
      size: { width: 1680, height: 1080 },
      quality: 'full',
      device: { viewport: { width: 800, height: 360 }, devicePixelRatio: 3 },
      source: { kind: 'virtual' },
    })
    expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
  })

  it('asks for a copy of a real monitor when one is chosen', () => {
    const message = streamMessageFor({ width: 1680, height: 1080 }, screen, {
      kind: 'mirror',
      displayId: '2528732444',
    })
    expect(message).toMatchObject({
      type: 'stream.request',
      source: { kind: 'mirror', displayId: '2528732444' },
    })
    expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
  })

  it('carries the viewport it is sent with, not the one the phone paired with', () => {
    // Portrait 412x800 paired; after rotating the toolbars leave 892x412, not 800x412.
    const rotated = { width: 892, height: 412, devicePixelRatio: 2.625 }
    const { stream } = computeSplit({
      viewport: rotated,
      devicePixelRatio: rotated.devicePixelRatio,
      monitorFraction: SPLIT_PRESETS['50-50'],
    })
    const message = streamMessageFor(stream, rotated)
    expect(message).toMatchObject({
      type: 'stream.request',
      device: { viewport: { width: 892, height: 412 }, devicePixelRatio: 2.625 },
    })
    expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
  })

  it('stops the stream on the widgets-only split', () => {
    const { stream } = computeSplit({
      viewport: screen,
      devicePixelRatio: screen.devicePixelRatio,
      monitorFraction: SPLIT_PRESETS.widgets,
    })
    const message = streamMessageFor(stream, screen)
    expect(message).toEqual({ type: 'stream.stop' })
    expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
  })
})
