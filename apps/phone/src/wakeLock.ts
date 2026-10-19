/**
 * Keeps the screen on while the phone is connected. A phone left alone locks itself, and a
 * locked phone suspends the page, which drops the PC: no good for a second monitor or a
 * widget panel. iOS has honoured this in home screen apps since 18.4.
 *
 * The browser lets go of the lock whenever the page is hidden, so it is taken again each time
 * the page comes back. Where it may only be taken from a tap, the next tap takes it.
 */

let wanted = false
let lock: WakeLockSentinel | null = null
let requesting = false

export function keepScreenOn(on: boolean): void {
  wanted = on
  if (on) void take()
  else void lock?.release().catch(() => {})
}

async function take(): Promise<void> {
  if (!wanted || lock || requesting || document.visibilityState !== 'visible') return
  if (!('wakeLock' in navigator)) return
  requesting = true
  try {
    const taken = await navigator.wakeLock.request('screen')
    taken.addEventListener('release', () => {
      if (lock === taken) lock = null
    })
    lock = taken
    // Turned off while the request was out.
    if (!wanted) void taken.release().catch(() => {})
  } catch {
    window.addEventListener('pointerdown', () => void take(), { once: true })
  } finally {
    requesting = false
  }
}

document.addEventListener('visibilitychange', () => void take())
