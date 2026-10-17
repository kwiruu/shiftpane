import type { SafeArea, ScreenTurn } from '@shiftpane/protocol'
import { useEffect } from 'react'
import { sendToPc } from './link.ts'
import type { Viewport } from './useViewport.ts'

/** Wait this long after the screen stops changing before telling the PC. */
export const SCREEN_REPORT_DELAY_MS = 200

/**
 * Tells the PC how this screen is laid out (size, safe area, split, which way up) so the
 * desktop editor previews the board exactly as this phone shows it. Sent once connected
 * (`sessionId`), again after every reconnection, and after a short pause whenever anything
 * changes, so a rotation or a collapsing browser toolbar sends one report, not a burst.
 */
export function useScreenReport(
  sessionId: string | null,
  viewport: Viewport,
  monitorFraction: number,
  safeArea: SafeArea,
  turn: ScreenTurn | undefined,
): void {
  const { width, height, devicePixelRatio } = viewport
  const { top, right, bottom, left } = safeArea
  useEffect(() => {
    if (sessionId === null || !(width > 0 && height > 0 && devicePixelRatio > 0)) return
    const timer = setTimeout(() => {
      sendToPc({
        type: 'screen',
        viewport: { width: Math.round(width), height: Math.round(height) },
        devicePixelRatio,
        monitorFraction,
        safeArea: { top, right, bottom, left },
        turn,
      })
    }, SCREEN_REPORT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [sessionId, width, height, devicePixelRatio, monitorFraction, top, right, bottom, left, turn])
}
