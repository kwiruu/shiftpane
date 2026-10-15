import { useEffect, useState } from 'react'
import type { FirewallState } from '../../shared/firewall.ts'

/** Live Windows Firewall status from the main process. */
export function useFirewall(): FirewallState {
  const [state, setState] = useState<FirewallState>({ status: 'unknown' })
  useEffect(() => {
    const unsubscribe = window.shiftpane.firewall.onChange(setState)
    void window.shiftpane.firewall.get().then((current) => {
      if (current) setState(current)
    })
    return unsubscribe
  }, [])
  return state
}
