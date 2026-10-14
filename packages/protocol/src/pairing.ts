/**
 * Pairing: the desktop app shows a QR code for `https://<lan-ip>:<port>/#t=<token>`.
 * The token sits in the URL fragment so it never reaches server logs or a Referer header;
 * the phone reads it and sends it as the first WebSocket message.
 */

import { z } from 'zod'

/** 128 random bits, base64url without padding. */
export const TOKEN_BYTES = 16
const TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 8) / 6)

export const PairingToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'token must be base64url')
  .min(TOKEN_LENGTH, `token must carry at least ${TOKEN_BYTES * 8} bits`)
  .max(128)
  .brand<'PairingToken'>()

export type PairingToken = z.infer<typeof PairingToken>

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

/** Uses Web Crypto, available in Node, Electron and every phone browser. */
export function generatePairingToken(): PairingToken {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  return PairingToken.parse(toBase64Url(bytes))
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
