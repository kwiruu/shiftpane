import type { PairingState } from '../../../shared/pairing.ts'

/** How long a fresh QR code can go unanswered before the page suggests the network is in the way. */
export const SILENCE_HINT_MS = 45_000

type Ready = Extract<PairingState, { status: 'ready' }>

/**
 * Whether to tell the user that no other device has reached this PC for a while.
 *
 * Silence has more than one cause (the phone may not have scanned yet), so this only says what
 * is likely and what to try; it never claims to know. It stays quiet once any phone has
 * connected or any request has arrived from another device.
 */
export function showSilenceHint(
  state: Pick<Ready, 'diagnostics' | 'phones' | 'watchingSince'>,
  now: number,
): boolean {
  const { pageAt, testAt, socketAt } = state.diagnostics
  if (state.phones.length > 0) return false
  if (pageAt !== null || testAt !== null || socketAt !== null) return false
  return now - state.watchingSince >= SILENCE_HINT_MS
}
