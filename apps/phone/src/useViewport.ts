import { useSyncExternalStore } from 'react'

export interface Viewport {
  width: number
  height: number
  devicePixelRatio: number
}

let cached: Viewport | undefined

function read(): Viewport {
  const next = {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }
  if (
    cached?.width !== next.width ||
    cached.height !== next.height ||
    cached.devicePixelRatio !== next.devicePixelRatio
  ) {
    cached = next
  }
  return cached
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/** Layout viewport in CSS pixels plus the device pixel ratio, updated on resize and rotation. */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, read)
}
