import type { PhoneMessage } from '@shiftpane/protocol'

type StreamMessage = Extract<PhoneMessage, { type: 'stream.request' | 'stream.stop' }>

/** The phone's viewport in CSS pixels and its pixel ratio, as `useViewport` reports them. */
export interface ScreenInfo {
  width: number
  height: number
  devicePixelRatio: number
}

/**
 * The message that makes the PC's monitor match `stream` (null: no monitor wanted).
 *
 * A request carries the viewport `stream` was computed from, so the PC can prepare the sizes of
 * this exact screen, not of the viewport the phone paired with.
 */
export function streamMessageFor(
  stream: { width: number; height: number } | null,
  screen: ScreenInfo,
): StreamMessage {
  return stream
    ? {
        type: 'stream.request',
        size: { width: stream.width, height: stream.height },
        quality: 'full',
        device: {
          viewport: { width: screen.width, height: screen.height },
          devicePixelRatio: screen.devicePixelRatio,
        },
      }
    : { type: 'stream.stop' }
}
