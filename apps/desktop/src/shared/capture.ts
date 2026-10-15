/**
 * Messages between the main process and the capture page (the desktop window's renderer, which
 * is where `getDisplayMedia` and the `RTCPeerConnection` live). Types and schemas only: shared
 * by main, preload and renderer.
 *
 * Both directions are parsed with these schemas on arrival, like every message that crosses a
 * process boundary. The signaling messages are the protocol's own `rtc.signal`, so the main
 * process relays them between the phone and the renderer without translating anything.
 */

import { PcRtcSignalMessage, PhoneRtcSignalMessage } from '@shiftpane/protocol'
import { z } from 'zod'

const Session = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Dimension = z.number().int().positive().max(16_384)

/** Main -> capture page. */
export const CaptureCommand = z.discriminatedUnion('type', [
  /** Capture the display main has armed, open a peer connection and offer its video. */
  z.object({ type: z.literal('start'), session: Session }),
  /** The display was resized or replaced: capture the newly armed source into the same stream. */
  z.object({ type: z.literal('recapture'), session: Session }),
  /** Stop capturing and close the connection. */
  z.object({ type: z.literal('stop'), session: Session }),
  /** The phone's answer, and its candidates. */
  PhoneRtcSignalMessage,
])
export type CaptureCommand = z.infer<typeof CaptureCommand>

/** Capture page -> main. */
export const CaptureEvent = z.discriminatedUnion('type', [
  /** The PC's offer, and its candidates, for the phone. */
  PcRtcSignalMessage,
  /** Encoded frames are being sent, at this size. */
  z.object({
    type: z.literal('flowing'),
    session: Session,
    size: z.object({ width: Dimension, height: Dimension }),
  }),
  /** Capture or the connection failed; `message` is shown to the phone's user. */
  z.object({ type: z.literal('failed'), session: Session, message: z.string().max(512) }),
])
export type CaptureEvent = z.infer<typeof CaptureEvent>
