import type { ScreenTurn } from '@shiftpane/protocol'
import { useSyncExternalStore } from 'react'

/** `window.orientation`, which older iOS has instead of `screen.orientation`. */
const LEGACY: Record<number, ScreenTurn> = {
  0: 'portrait-primary',
  180: 'portrait-secondary',
  90: 'landscape-primary',
  [-90]: 'landscape-secondary',
}

function read(): ScreenTurn | undefined {
  const type = screen.orientation?.type
  if (type) return type
  const legacy = (window as Window & { orientation?: number }).orientation
  return legacy === undefined ? undefined : LEGACY[legacy]
}

function subscribe(onChange: () => void) {
  screen.orientation?.addEventListener('change', onChange)
  window.addEventListener('orientationchange', onChange)
  window.addEventListener('resize', onChange)
  return () => {
    screen.orientation?.removeEventListener('change', onChange)
    window.removeEventListener('orientationchange', onChange)
    window.removeEventListener('resize', onChange)
  }
}

/**
 * Which way up the phone is held, so space kept clear for the camera follows it when the
 * phone is turned round. Undefined when the browser cannot tell.
 */
export function useScreenTurn(): ScreenTurn | undefined {
  return useSyncExternalStore(subscribe, read)
}
