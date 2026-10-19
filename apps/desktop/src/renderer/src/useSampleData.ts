import { type PcData, SampleFeed } from '@shiftpane/board'
import { useEffect, useSyncExternalStore } from 'react'

// Sample data for previews in this window; the PC's real numbers only go to phones.
const feed = new SampleFeed()
let users = 0

/** Made-up PC data for widget previews, ticking while any view shows them. */
export function useSampleData(): PcData {
  useEffect(() => {
    users += 1
    feed.start()
    return () => {
      users -= 1
      if (users === 0) feed.stop()
    }
  }, [])
  return useSyncExternalStore(feed.store.subscribe, feed.store.getState)
}
