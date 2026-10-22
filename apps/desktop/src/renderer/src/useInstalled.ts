import type { SampleInstalled } from '@shiftpane/board'
import { useSyncExternalStore } from 'react'
import type { InstalledInfo } from '../../shared/widgets.ts'
import { sampleFeed } from './sampleFeed.ts'

/**
 * The widgets installed on this PC, kept current from the main process. Every change also goes
 * to the sample feed, so the window's previews draw installed widgets like the built-in ones:
 * from their view, with `sample.json` and the sample PC standing in for real data.
 */

let installed: InstalledInfo[] = []
const listeners = new Set<() => void>()
let listening = false

const toSample = (info: InstalledInfo): SampleInstalled => ({
  id: info.id,
  name: info.name,
  version: info.version,
  sizes: info.sizes,
  actions: info.actions,
  view: info.view,
  sample: info.sample,
  config: info.config.values,
  sources: info.sources,
})

function set(next: InstalledInfo[]): void {
  installed = next
  sampleFeed.showInstalled(next.map(toSample))
  for (const listener of listeners) listener()
}

function listen(): void {
  if (listening) return
  listening = true
  let changed = false
  window.shiftpane.widgets.onChange((next) => {
    changed = true
    set(next)
  })
  void window.shiftpane.widgets.list().then((first) => {
    // A change that arrived first is newer than this answer.
    if (!changed) set(first)
  })
}

const subscribe = (listener: () => void) => {
  listen()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstalled(): InstalledInfo[] {
  return useSyncExternalStore(subscribe, () => installed)
}
