/**
 * Pairing: the desktop app shows a QR code for `https://<lan-ip>:<port>/#t=<token>`.
 * The token sits in the URL fragment so it never reaches server logs or a Referer header;
 * the phone reads it and sends it as the first WebSocket message.
 *
 * Under the QR code the desktop app also shows a six-digit code. An app on the iPhone home
 * screen cannot be reached by a link (the camera opens every link in Safari, whose storage the
 * home screen app does not share), so it pairs by having the code typed in instead.
 *
 * Either way the PC answers with a key for that phone, which the phone saves and presents from
 * then on: a reload, a PC restart or a new QR code never asks it to pair again.
 */

import { z } from 'zod'

/** 128 random bits, base64url without padding. */
export const TOKEN_BYTES = 16
const TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 8) / 6)

const RandomSecret = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url')
  .min(TOKEN_LENGTH, `must carry at least ${TOKEN_BYTES * 8} bits`)
  .max(128)

export const PairingToken = RandomSecret.brand<'PairingToken'>()
export type PairingToken = z.infer<typeof PairingToken>

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const randomBase64Url = () => toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))

/** Uses Web Crypto, available in Node, Electron and every phone browser. */
export function generatePairingToken(): PairingToken {
  return PairingToken.parse(randomBase64Url())
}

export function pairingUrl(options: { host: string; port: number; token: PairingToken }): string {
  const url = new URL(`https://${options.host}`)
  url.port = String(options.port)
  url.hash = new URLSearchParams({ t: options.token }).toString()
  return url.toString()
}

/** Reads the token from `location.hash`. Returns null if it is missing or malformed. */
export function parsePairingHash(hash: string): PairingToken | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t')
  const parsed = PairingToken.safeParse(token)
  return parsed.success ? parsed.data : null
}

/** Compares tokens without leaking the match length through timing. */
export function tokensEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/** The code to type on the phone. Short, so the PC only takes a few wrong tries at each one. */
export const PAIRING_CODE_DIGITS = 6

export const PairingCode = z
  .string()
  .regex(new RegExp(`^\\d{${PAIRING_CODE_DIGITS}}$`), `code must be ${PAIRING_CODE_DIGITS} digits`)
  .brand<'PairingCode'>()
export type PairingCode = z.infer<typeof PairingCode>

export function generatePairingCode(): PairingCode {
  const range = 10 ** PAIRING_CODE_DIGITS
  // Drop the top of the 32-bit range so every code is equally likely.
  const limit = Math.floor(2 ** 32 / range) * range
  const word = new Uint32Array(1)
  do {
    crypto.getRandomValues(word)
  } while ((word[0] ?? limit) >= limit)
  return PairingCode.parse(String((word[0] ?? 0) % range).padStart(PAIRING_CODE_DIGITS, '0'))
}

/** Reads a code as typed: spaces and dashes are ignored. Null until it is complete. */
export function parsePairingCode(input: string): PairingCode | null {
  const parsed = PairingCode.safeParse(input.replace(/[\s-]/g, ''))
  return parsed.success ? parsed.data : null
}

/** Which paired phone this is, as the PC named it. Not a secret. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

/** The phone's own secret, which the PC only keeps a hash of. */
export const DeviceKey = RandomSecret.brand<'DeviceKey'>()
export type DeviceKey = z.infer<typeof DeviceKey>

export function generateDeviceKey(): DeviceKey {
  return DeviceKey.parse(randomBase64Url())
}

/** What a phone keeps once paired, and presents instead of a token or code. */
export const SavedPairing = z.object({ deviceId: DeviceId, key: DeviceKey })
export type SavedPairing = z.infer<typeof SavedPairing>

/** How a phone proves it may connect, in its `hello`. */
export const PhoneAuth = z.discriminatedUnion('kind', [
  /** From the QR code just scanned. */
  z.object({ kind: z.literal('token'), token: PairingToken }),
  /** Typed in from the desktop app. */
  z.object({ kind: z.literal('code'), code: PairingCode }),
  /** Saved from an earlier pairing. */
  z.object({ kind: z.literal('key'), ...SavedPairing.shape }),
])
export type PhoneAuth = z.infer<typeof PhoneAuth>
