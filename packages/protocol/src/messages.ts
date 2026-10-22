/**
 * The WebSocket protocol between the desktop app and the phone.
 *
 * Both sides parse every incoming frame with these schemas: a bad message is rejected
 * with an `error` reply, never trusted and never a crash. Add a message by adding a schema
 * to the matching union; `type` is the discriminator.
 */

import { actionNames } from '@shiftpane/widget-sdk'
import { z } from 'zod'
import { Board } from './board.ts'
import { PhoneAuth, SavedPairing } from './pairing.ts'
import { InstalledWidget, MediaAction, WidgetId } from './widgets.ts'

/** 2: `hello` carries `auth` (token, code or saved key) instead of only a token. */
export const PROTOCOL_VERSION = 2

const Dimension = z.number().int().positive().max(16_384)
const Size = z.object({ width: Dimension, height: Dimension })
const DevicePixelRatio = z.number().positive().max(8)

export const Quality = z.enum(['full', 'half', 'auto'])
export type Quality = z.infer<typeof Quality>

/** One of the PC's real monitors: Electron's `Display.id`, as a string. */
const DisplayId = z.string().regex(/^[0-9A-Za-z_-]{1,32}$/)

/**
 * What the phone's monitor area shows: the virtual monitor ShiftPane adds to the PC (extend),
 * or a copy of one of the PC's real monitors (duplicate).
 */
export const MonitorSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('virtual') }),
  z.object({ kind: z.literal('mirror'), displayId: DisplayId }),
])
export type MonitorSource = z.infer<typeof MonitorSource>

// ---------------------------------------------------------------------------------------
// phone -> PC
// ---------------------------------------------------------------------------------------

/** Must be the first message on a connection; anything else closes the socket. */
export const HelloMessage = z.object({
  type: z.literal('hello'),
  protocol: z.literal(PROTOCOL_VERSION),
  auth: PhoneAuth,
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
  /**
   * What to stream. Absent means the virtual monitor, which is what phones that predate this
   * field ask for. When it is a real monitor, `size` is not applied to anything: that monitor
   * keeps its own resolution and the phone letterboxes it.
   */
  source: MonitorSource.optional(),
})

export const StreamStopMessage = z.object({ type: z.literal('stream.stop') })

/**
 * The widgets on the phone that need data from the PC. The PC runs those collectors only while
 * some phone shows them, and replaces the previous list with each message.
 */
export const WidgetsSubscribeMessage = z.object({
  type: z.literal('widgets.subscribe'),
  widgets: z.array(WidgetId).max(32),
})

/** A media button on the phone; the PC presses it on whatever is playing. */
export const MediaControlMessage = z.object({
  type: z.literal('media.control'),
  action: MediaAction,
})

/**
 * A button on an installed widget. The PC presses it only when that widget's manifest declares
 * the action, which the user agreed to when installing it. `value` is the volume for
 * `audio.set-volume`, 0-100.
 */
export const WidgetActionMessage = z.object({
  type: z.literal('widget.action'),
  widget: WidgetId,
  action: z.enum(actionNames),
  value: z.number().min(0).max(100).optional(),
})
export type WidgetAction = Omit<z.infer<typeof WidgetActionMessage>, 'type'>

const Inset = z.number().min(0).max(512)

/** Which way up the screen is, as `screen.orientation.type` says. */
export const ScreenTurn = z.enum([
  'portrait-primary',
  'portrait-secondary',
  'landscape-primary',
  'landscape-secondary',
])
export type ScreenTurn = z.infer<typeof ScreenTurn>

/**
 * How this phone's screen is laid out right now. Sent after `welcome` and again, after a short
 * pause, whenever the viewport (a rotation, a collapsing browser toolbar) or the split changes,
 * so the desktop editor can preview the board exactly as this phone shows it.
 */
export const ScreenMessage = z.object({
  type: z.literal('screen'),
  /** CSS pixels. */
  viewport: Size,
  devicePixelRatio: DevicePixelRatio,
  /** The split: share of the long axis the monitor takes, 0 (widgets only) to 1 (monitor only). */
  monitorFraction: z.number().min(0).max(1),
  /** The notch, rounded corners and home bar the page keeps clear of, in CSS pixels. */
  safeArea: z.object({ top: Inset, right: Inset, bottom: Inset, left: Inset }),
  /** Absent when the browser cannot tell; treated as the usual way up. */
  turn: ScreenTurn.optional(),
  /**
   * What the monitor area shows, so the desktop window's picker follows the phone. Optional:
   * a phone that predates it says nothing, and the window then takes it for the virtual monitor.
   */
  source: MonitorSource.optional(),
})
export type ScreenReport = Omit<z.infer<typeof ScreenMessage>, 'type'>
export type SafeArea = ScreenReport['safeArea']

/**
 * The widget board changed on this phone. The PC keeps it and passes it on to the other phones
 * and the desktop editor.
 */
export const BoardSaveMessage = z.object({
  type: z.literal('board.save'),
  board: Board,
})

// WebRTC signaling rides the same socket; there is no STUN/TURN on a LAN, so a connection is
// host candidates only. The PC sends the video, so the PC makes the offer and the phone answers.
//
// Each offer starts a new negotiation and carries a fresh `session` number. Everything that
// belongs to it (the answer, both sides' candidates) repeats that number, so a straggler from
// a negotiation that was already replaced is dropped instead of corrupting the new one.

const RtcSession = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Sdp = z
  .string()
  .min(1)
  .max(64 * 1024)

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
  WidgetsSubscribeMessage,
  MediaControlMessage,
  WidgetActionMessage,
  ScreenMessage,
  BoardSaveMessage,
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
  /**
   * Present when this connection paired the phone, with a token or a code: the phone saves it
   * and presents it in every `hello` after this one.
   */
  pairing: SavedPairing.optional(),
})

/**
 * Video is flowing to this phone, at `size` physical pixels. Sent once the first frame has been
 * encoded, and again whenever the monitor's size changes while the stream stays up.
 */
export const StreamReadyMessage = z.object({
  type: z.literal('stream.ready'),
  size: Size,
})

/**
 * The PC's real monitors, which the phone can duplicate. Sent after `welcome` and again
 * whenever monitors are added, removed or change resolution. The virtual monitor is not listed.
 */
export const MonitorsMessage = z.object({
  type: z.literal('monitors'),
  monitors: z
    .array(
      z.object({
        id: DisplayId,
        name: z.string().max(128),
        /** Physical pixels. */
        width: Dimension,
        height: Dimension,
        primary: z.boolean(),
      }),
    )
    .max(16),
})
export type MonitorInfo = z.infer<typeof MonitorsMessage>['monitors'][number]

/** Fresh output from one widget collector. `data` is whatever the collector returned. */
export const WidgetUpdateMessage = z.object({
  type: z.literal('widget.update'),
  instanceId: z.string().min(1).max(64),
  widgetId: z.string().min(1).max(64),
  data: z.json(),
  at: z.number(),
})

/**
 * The widgets installed on the PC, which a board can place besides the built-in ones: what each
 * is called and its view. Sent after `welcome` and again whenever one is installed, updated or
 * removed; each message replaces the whole list. A phone that predates this message drops it as
 * unknown and shows those widgets as missing, which is why it did not bump `PROTOCOL_VERSION`.
 */
export const InstalledWidgetsMessage = z.object({
  type: z.literal('widgets.installed'),
  widgets: z.array(InstalledWidget).max(64),
})

/**
 * The widget board to show. Sent after `welcome`, then whenever the board changes on another
 * phone or in the desktop editor. Null after `welcome` when the PC has no board yet: the phone
 * then sends its own with `board.save`.
 */
export const BoardMessage = z.object({
  type: z.literal('board'),
  board: Board.nullable(),
})

/**
 * The splits a phone offers, by the names its menu uses. `@shiftpane/layout`'s `SPLIT_PRESETS`
 * has the same names (a phone test keeps the two in step); this package cannot import it.
 */
export const SplitName = z.enum(['monitor', '70-30', '50-50', 'widgets'])
export type SplitName = z.infer<typeof SplitName>

/**
 * The desktop window picked a split for this phone. The phone switches to it and keeps it, then
 * reports its screen as usual, so the editor's preview follows. It is sent by name, never as a
 * share of the screen, so a phone only ever shows a split its own menu offers. A phone that
 * predates this message drops it as unknown, which is why it did not bump `PROTOCOL_VERSION`.
 */
export const SplitSetMessage = z.object({
  type: z.literal('split.set'),
  split: SplitName,
})

/**
 * The desktop window picked what this phone's monitor area shows. The phone switches to it and
 * keeps it, like one picked from its own menu, then reports its screen as usual so the window's
 * picker follows. The PC only ever sends a monitor it is offering in `monitors`, or the virtual
 * one. A phone that predates this message drops it as unknown, which is why it did not bump
 * `PROTOCOL_VERSION`.
 */
export const SourceSetMessage = z.object({
  type: z.literal('source.set'),
  source: MonitorSource,
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
  MonitorsMessage,
  WidgetUpdateMessage,
  InstalledWidgetsMessage,
  BoardMessage,
  SplitSetMessage,
  SourceSetMessage,
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
