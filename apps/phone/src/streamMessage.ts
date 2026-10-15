import type { PhoneMessage } from '@shiftpane/protocol'

type StreamMessage = Extract<PhoneMessage, { type: 'stream.request' | 'stream.stop' }>

/** The message that makes the PC's monitor match `stream` (null: no monitor wanted). */
export function streamMessageFor(stream: { width: number; height: number } | null): StreamMessage {
  return stream
    ? {
        type: 'stream.request',
        size: { width: stream.width, height: stream.height },
        quality: 'full',
      }
    : { type: 'stream.stop' }
}
