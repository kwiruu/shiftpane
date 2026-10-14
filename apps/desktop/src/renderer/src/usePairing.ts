import { useEffect, useState } from 'react'
import type { PairingState } from '../../shared/pairing.ts'

/** Live pairing state from the main process. */
export function usePairing(): PairingState {
  const [state, setState] = useState<PairingState>({ status: 'starting' })
  useEffect(() => {
    const unsubscribe = window.shiftpane.pairing.onChange(setState)
    void window.shiftpane.pairing.get().then((current) => {
      if (current) setState(current)
    })
    return unsubscribe
  }, [])
  return state
}
