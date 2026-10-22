import type { PcData } from '@shiftpane/board'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { StoreList } from '../../shared/widgets.ts'
import { storeFeed } from './storeFeed.ts'

export type StoreState = { status: 'loading' } | StoreList

/**
 * What the marketplace offers, read when a view asks for it, with live-looking previews: each
 * widget drawn from its verified package on the sample PC.
 */
export function useStore(): {
  state: StoreState
  data: PcData
  refresh: () => void
} {
  const [state, setState] = useState<StoreState>({ status: 'loading' })
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    let current = true
    void window.shiftpane.store.list(asked > 0).then((list) => {
      if (!current) return
      setState(list)
      if (list.ok) {
        storeFeed.showInstalled(
          list.widgets.flatMap((widget) =>
            widget.preview
              ? [
                  {
                    id: widget.id,
                    name: widget.name,
                    version: widget.version ?? widget.latest,
                    sizes: widget.preview.sizes,
                    actions: widget.preview.actions,
                    view: widget.preview.view,
                    sample: widget.preview.sample,
                    config: widget.preview.config,
                    sources: widget.preview.sources,
                  },
                ]
              : [],
          ),
        )
      }
    })
    return () => {
      current = false
    }
  }, [asked])

  useEffect(() => {
    storeFeed.start()
    return () => storeFeed.stop()
  }, [])

  const data = useSyncExternalStore(storeFeed.store.subscribe, storeFeed.store.getState)
  return {
    state,
    data,
    refresh: () => {
      setState({ status: 'loading' })
      setAsked((n) => n + 1)
    },
  }
}
