/**
 * The WebSocket protocol between the desktop app and the phone.
 *
 * Both sides parse every incoming frame with these schemas: a bad message is rejected
 * with an `error` reply, never trusted and never a crash. Add a message by adding a schema
 * to the matching union; `type` is the discriminator.
 */

import { z } from 'zod'
import { PairingToken } from './pairing.ts'

export const PROTOCOL_VERSION = 1

const Dimension = z.number().int().positive().max(16_384)
const Size = z.object({ width: Dimension, height: Dimension })
const DevicePixelRatio = z.number().positive().max(8)

export const Quality = z.enum(['full', 'half', 'auto'])
export type Quality = z.infer<typeof Quality>

// ---------------------------------------------------------------------------------------
// phone -> PC
// ---------------------------------------------------------------------------------------

/** Must be the first message on a connection; anything else closes the socket. */
export const HelloMessage = z.object({
  type: z.literal('hello'),
  protocol: z.literal(PROTOCOL_VERSION),
  token: PairingToken,
  device: z.object({
    name: z.string().trim().min(1).max(64),
    /** CSS pixels. */
    viewport: Size,
    devicePixelRatio: DevicePixelRatio,
    touch: z.boolean(),
  }),
})

/**
 * Sent when the split changes (a divider release, a rotation, a collapsing browser toolbar),
 * after a short pause.
 */
export const StreamRequestMessage = z.object({
  type: z.literal('stream.request'),
  /** Physical pixels, already clamped and rounded by `@shiftpane/layout`. */
  size: Size,
  quality: Quality,
  /**
   * The screen `size` was computed from, as it is now. A phone's viewport after a rotation is
   * not the paired viewport turned sideways (browser chrome changes `innerHeight`), so the PC
   * uses this to add the sizes this screen may ask for next to the virtual display in the same
   * step as the resize, behind one administrator prompt.
   *
   * Optional so a phone that does not send it still works, at the cost of one prompt per new
   * size; that is why this addition did not bump `PROTOCOL_VERSION`.
   */
  device: z.object({ viewport: Size, devicePixelRatio: DevicePixelRatio }).optional(),
})

export const StreamStopMessage = z.object({ type: z.literal('stream.stop') })

// WebRTC signaling rides the same socket; there is no STUN/TURN on a LAN, so a connection is
// host candidates only. The PC sends the video, so the PC makes the offer and the phone answers.
//
// Each offer starts a new negotiation and carries a fresh `session` number. Everything that
// belongs to it (the answer, both sides' candidates) repeats that number, so a straggler from
// a negotiation that was already replaced is dropped instead of corrupting the new one.

const RtcSession = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Sdp = z.string().min(1).max(64 * 1024)

const SdpOffer = z.object({ kind: z.literal('offer'), sdp: Sdp })
const SdpAnswer = z.object({ kind: z.literal('answer'), sdp: Sdp })

/** One ICE candidate; an empty `candidate` string is the end-of-candidates marker. */
const IceCandidate = z.object({
  kind: z.literal('candidate'),
  candidate: z.string().max(4096),
  sdpMid: z.string().max(64).nullable(),
  sdpMLineIndex: z.number().int().nonnegative().max(255).nullable(),
})

/** Phone -> PC: the answer to the PC's offer, then the phone's candidates. */
export const PhoneRtcSignalMessage = z.object({
  type: z.literal('rtc.signal'),
  session: RtcSession,
  signal: z.discriminatedUnion('kind', [SdpAnswer, IceCandidate]),
})

/** PC -> phone: the offer that carries the monitor's video track, then the PC's candidates. */
export const PcRtcSignalMessage = z.object({
  type: z.literal('rtc.signal'),
  session: RtcSession,
  signal: z.discriminatedUnion('kind', [SdpOffer, IceCandidate]),
})

export type RtcCandidate = z.infer<typeof IceCandidate>

export const PingMessage = z.object({ type: z.literal('ping'), at: z.number() })
export const PongMessage = z.object({ type: z.literal('pong'), at: z.number() })

export const PhoneMessage = z.discriminatedUnion('type', [
  HelloMessage,
  StreamRequestMessage,
  StreamStopMessage,
  PhoneRtcSignalMessage,
  PingMessage,
  PongMessage,
])
export type PhoneMessage = z.infer<typeof PhoneMessage>

// ---------------------------------------------------------------------------------------
// PC -> phone
// ---------------------------------------------------------------------------------------

export const WelcomeMessage = z.object({
  type: z.literal('welcome'),
  protocol: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1).max(64),
  pc: z.object({
    name: z.string().max(128),
    platform: z.enum(['windows', 'macos', 'linux']),
  }),
  features: z.object({
    /** False when the virtual display backend is not ready; the phone falls back to widgets. */
    display: z.boolean(),
    remoteControl: z.boolean(),
  }),
})

/**
 * Video is flowing to this phone, at `size` physical pixels. Sent once the first frame has been
 * encoded, and again whenever the monitor's size changes while the stream stays up.
 */
export const StreamReadyMessage = z.object({
  type: z.literal('stream.ready'),
  size: Size,
})

/** Fresh output from one widget collector. `data` is whatever the collector returned. */
export const WidgetUpdateMessage = z.object({
  type: z.literal('widget.update'),
  instanceId: z.string().min(1).max(64),
  widgetId: z.string().min(1).max(64),
  data: z.json(),
  at: z.number(),
})

export const ErrorCode = z.enum([
  'bad-message',
  'unauthorized',
  'protocol-mismatch',
  'display-unavailable',
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorMessage = z.object({
  type: z.literal('error'),
  code: ErrorCode,
  message: z.string().max(1024),
})

export const PcMessage = z.discriminatedUnion('type', [
  WelcomeMessage,
  StreamReadyMessage,
  WidgetUpdateMessage,
  PcRtcSignalMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
])
export type PcMessage = z.infer<typeof PcMessage>

// ---------------------------------------------------------------------------------------
// framing
// ---------------------------------------------------------------------------------------

/** Frames above this size are rejected before JSON.parse runs. */
export const MAX_FRAME_BYTES = 256 * 1024

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string }

function parseFrame<T>(schema: z.ZodType<T>, frame: string): ParseResult<T> {
  if (frame.length > MAX_FRAME_BYTES) return { ok: false, error: 'frame too large' }
  let json: unknown
  try {
    json = JSON.parse(frame)
  } catch {
    return { ok: false, error: 'frame is not JSON' }
  }
  const result = schema.safeParse(json)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}

export const parsePhoneMessage = (frame: string) => parseFrame(PhoneMessage, frame)
export const parsePcMessage = (frame: string) => parseFrame(PcMessage, frame)

export const encode = (message: PhoneMessage | PcMessage): string => JSON.stringify(message)
