import type { MonitorInfo } from '@shiftpane/protocol'
import { useEffect, useState } from 'react'

/**
 * The PC's real monitors a phone can copy, kept current by the main process. The virtual
 * monitor is not among them: it is offered on its own.
 */
export function useMonitors(): MonitorInfo[] {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  useEffect(() => {
    let changed = false
    const unsubscribe = window.shiftpane.monitors.onChange((next) => {
      changed = true
      setMonitors(next)
    })
    void window.shiftpane.monitors.get().then((current) => {
      // A change that arrived first is newer than this answer.
      if (!changed && current) setMonitors(current)
    })
    return unsubscribe
  }, [])
  return monitors
}
