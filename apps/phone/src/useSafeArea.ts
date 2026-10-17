import type { SafeArea } from '@shiftpane/protocol'
import { useSyncExternalStore } from 'react'

const NONE: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 }

let probe: HTMLDivElement | null = null
let cached: SafeArea = NONE

/** CSS can read the safe area but JavaScript cannot, so a hidden element is padded with it. */
function read(): SafeArea {
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
    document.body.append(probe)
  }
  const style = getComputedStyle(probe)
  const next = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  }
  if (
    next.top !== cached.top ||
    next.right !== cached.right ||
    next.bottom !== cached.bottom ||
    next.left !== cached.left
  ) {
    cached = next
  }
  return cached
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
  }
}

/** The notch, rounded corners and home bar the page keeps clear of, in CSS pixels. */
export function useSafeArea(): SafeArea {
  return useSyncExternalStore(subscribe, read)
}
