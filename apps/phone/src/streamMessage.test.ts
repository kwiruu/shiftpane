import { computeSplit, SPLIT_PRESETS } from '@shiftpane/layout'
import { encode, parsePhoneMessage } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { streamMessageFor } from './streamMessage.ts'

const viewport = { width: 800, height: 360 }

describe('streamMessageFor', () => {
  it('asks for the monitor size the split computed, in a message the PC accepts', () => {
    const { stream } = computeSplit({
      viewport,
      devicePixelRatio: 3,
      monitorFraction: SPLIT_PRESETS['70-30'],
    })
    const message = streamMessageFor(stream)
    expect(message).toEqual({
      type: 'stream.request',
      size: { width: 1680, height: 1080 },
      quality: 'full',
    })
    expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
  })

  it('stops the stream on the widgets-only split', () => {
    const { stream } = computeSplit({
      viewport,
      devicePixelRatio: 3,
      monitorFraction: SPLIT_PRESETS.widgets,
    })
    const message = streamMessageFor(stream)
    expect(message).toEqual({ type: 'stream.stop' })
    expect(parsePhoneMessage(encode(message))).toEqual({ ok: true, message })
  })
})
