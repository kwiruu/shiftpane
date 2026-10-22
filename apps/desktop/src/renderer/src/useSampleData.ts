import type { PcData } from '@shiftpane/board'
import { useEffect, useSyncExternalStore } from 'react'
import { sampleFeed } from './sampleFeed.ts'
import { useInstalled } from './useInstalled.ts'

let users = 0

/** Made-up PC data for widget previews, installed widgets included, ticking while any view shows them. */
export function useSampleData(): PcData {
  // Keeps the feed's installed widgets current while previews are on screen.
  useInstalled()
  useEffect(() => {
    users += 1
    sampleFeed.start()
    return () => {
      users -= 1
      if (users === 0) sampleFeed.stop()
    }
  }, [])
  return useSyncExternalStore(sampleFeed.store.subscribe, sampleFeed.store.getState)
}
