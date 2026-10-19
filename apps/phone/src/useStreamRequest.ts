import type { MonitorSource } from '@shiftpane/protocol'
import { useEffect } from 'react'
import { sendToPc } from './link.ts'
import { type ScreenInfo, streamMessageFor } from './streamMessage.ts'

/** Wait this long after the split stops changing before asking the PC to resize the monitor. */
export const STREAM_REQUEST_DELAY_MS = 250

/**
 * Keeps the PC's monitor stream in step with this phone's monitor area and chosen source.
 *
 * `stream` is `computeSplit(...).stream`: the physical size to request, or null when the split
 * is widgets-only. `screen` is the viewport it was computed from, which the request carries so
 * the PC can prepare the sizes of this exact screen after a rotation. `source` says whether to
 * show the virtual monitor or a copy of one of the PC's real monitors. A change is sent after a
 * short pause so dragging the divider, a rotation or a collapsing browser toolbar produce one
 * request, not a burst. Connecting (or reconnecting after a Wi-Fi drop) sends the current state
 * again, which brings the stream back.
 *
 * Does nothing while `enabled` is false (not connected, or nothing to show).
 */
export function useStreamRequest(
  stream: { width: number; height: number } | null,
  screen: ScreenInfo,
  enabled: boolean,
  source: MonitorSource = { kind: 'virtual' },
): void {
  const width = stream?.width ?? null
  const height = stream?.height ?? null
  const { width: viewportWidth, height: viewportHeight, devicePixelRatio } = screen
  const sourceKind = source.kind
  const displayId = source.kind === 'mirror' ? source.displayId : null
  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => {
      const wanted = width !== null && height !== null ? { width, height } : null
      const chosen: MonitorSource =
        sourceKind === 'mirror' && displayId !== null
          ? { kind: 'mirror', displayId }
          : { kind: 'virtual' }
      sendToPc(
        streamMessageFor(
          wanted,
          { width: viewportWidth, height: viewportHeight, devicePixelRatio },
          chosen,
        ),
      )
    }, STREAM_REQUEST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [
    enabled,
    width,
    height,
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
    sourceKind,
    displayId,
  ])
}
