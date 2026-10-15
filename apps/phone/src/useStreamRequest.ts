import { useEffect } from 'react'
import { type ScreenInfo, streamMessageFor } from './streamMessage.ts'
import { sendToPc } from './usePcConnection.ts'

/** Wait this long after the split stops changing before asking the PC to resize the monitor. */
export const STREAM_REQUEST_DELAY_MS = 250

/**
 * Keeps the PC's virtual monitor at the size of this phone's monitor area.
 *
 * `stream` is `computeSplit(...).stream`: the physical size to request, or null when the split
 * is widgets-only. `screen` is the viewport it was computed from, which the request carries so
 * the PC can prepare the sizes of this exact screen after a rotation. A change is sent after a
 * short pause so dragging the divider, a rotation or a collapsing browser toolbar produce one
 * request, not a burst. Connecting (or reconnecting after a Wi-Fi drop) sends the current size
 * again, which brings the monitor back.
 *
 * Does nothing while `enabled` is false (not connected, or the PC reports no display backend).
 */
export function useStreamRequest(
  stream: { width: number; height: number } | null,
  screen: ScreenInfo,
  enabled: boolean,
): void {
  const width = stream?.width ?? null
  const height = stream?.height ?? null
  const { width: viewportWidth, height: viewportHeight, devicePixelRatio } = screen
  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => {
      const wanted = width !== null && height !== null ? { width, height } : null
      sendToPc(
        streamMessageFor(wanted, {
          width: viewportWidth,
          height: viewportHeight,
          devicePixelRatio,
        }),
      )
    }, STREAM_REQUEST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, width, height, viewportWidth, viewportHeight, devicePixelRatio])
}
