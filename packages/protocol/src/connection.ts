/**
 * Connection rules shared by the desktop server and the phone client.
 *
 * WebSocket close codes 4000-4999 are reserved for applications. The phone shows a
 * different message for each, and only retries the ones marked retryable.
 */

/** WebSocket path on the desktop app's HTTPS server. */
export const WS_PATH = '/ws'

/**
 * Default port. An app on the phone's home screen is tied to the address it was added from, so
 * the desktop app keeps the port it used last and, when that is taken, tries the few after
 * this one before settling for any free port.
 */
export const DEFAULT_PORT = 47_820

/** How many ports from `DEFAULT_PORT` on the desktop app tries. */
export const PORT_RANGE = 10

/** The phone must send `hello` within this window or the socket is closed. */
export const HELLO_TIMEOUT_MS = 5_000

/** At most this many phones at once; a monitor is only useful on one, widgets on a few. */
export const MAX_PHONES = 4

export const CloseCode = {
  /** The user pressed Disconnect on the PC. */
  disconnected: 4000,
  /** First message was not a valid `hello`. */
  badHello: 4400,
  /**
   * Wrong token, code or key: the QR code was replaced, the code mistyped, or the PC was told
   * to forget this phone.
   */
  unauthorized: 4401,
  /** Too many wrong codes; the PC takes none until it shows a new one. */
  codeLocked: 4423,
  /** Phone and PC speak different protocol versions; one of them needs updating. */
  protocolMismatch: 4426,
  helloTimeout: 4408,
  tooManyPhones: 4429,
  /** The desktop app is quitting. */
  shuttingDown: 4503,
} as const

export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode]

/** Whether the phone should reconnect automatically after this close code. */
export function isRetryableClose(code: number): boolean {
  return !(
    code === CloseCode.disconnected ||
    code === CloseCode.unauthorized ||
    code === CloseCode.codeLocked ||
    code === CloseCode.protocolMismatch ||
    code === CloseCode.badHello
  )
}
