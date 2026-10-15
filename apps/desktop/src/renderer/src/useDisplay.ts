import { useEffect, useState } from 'react'
import type { DisplayState } from '../../shared/display.ts'

/** Live virtual-monitor status from the main process. */
export function useDisplay(): DisplayState {
  const [state, setState] = useState<DisplayState>({ status: 'unknown' })
  useEffect(() => {
    const unsubscribe = window.shiftpane.display.onChange(setState)
    void window.shiftpane.display.get().then((current) => {
      if (current) setState(current)
    })
    return unsubscribe
  }, [])
  return state
}
