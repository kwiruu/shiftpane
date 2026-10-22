import { useEffect, useState } from 'react'
import type { AccountState } from '../../shared/widgets.ts'

/** The marketplace sign-in, for sharing widgets. */
export function useAccount(): AccountState {
  const [state, setState] = useState<AccountState>({ status: 'signed-out' })
  useEffect(() => {
    let changed = false
    const off = window.shiftpane.account.onChange((next) => {
      changed = true
      setState(next)
    })
    void window.shiftpane.account.get().then((first) => {
      if (!changed && first) setState(first)
    })
    return off
  }, [])
  return state
}
