import { computeSplit, type Rect, SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'
import { parsePairingHash } from '@shiftpane/protocol'
import { useState } from 'react'
import { useViewport } from './useViewport.ts'

const placeAt = ({ x, y, width, height }: Rect) => ({ left: x, top: y, width, height })

const PRESET_LABELS: Record<SplitPreset, string> = {
  monitor: 'Monitor',
  '70-30': '70 / 30',
  '50-50': '50 / 50',
  widgets: 'Widgets',
}

/**
 * Placeholder shell: shows whether a pairing token arrived and what monitor the current
 * split would ask the PC for. The stream player and widget panel replace the two panes.
 */
export function App() {
  const viewport = useViewport()
  const [preset, setPreset] = useState<SplitPreset>('70-30')
  const paired = parsePairingHash(window.location.hash) !== null
  const layout = computeSplit({
    viewport,
    devicePixelRatio: viewport.devicePixelRatio,
    monitorFraction: SPLIT_PRESETS[preset],
  })

  return (
    <main className="relative h-full overflow-hidden bg-surface-sunken text-ink">
      <section
        aria-label="Monitor"
        style={placeAt(layout.monitor)}
        className="absolute grid place-items-center border-border border-r border-b bg-surface p-4 text-center"
      >
        {layout.stream && (
          <div>
            <p className="font-mono text-3xl text-accent tabular-nums">
              {layout.stream.width}×{layout.stream.height}
            </p>
            <p className="mt-1 text-ink-muted text-sm">monitor size for this split</p>
          </div>
        )}
      </section>

      <section
        aria-label="Widgets"
        style={placeAt(layout.panel)}
        className="absolute flex flex-col gap-4 overflow-y-auto p-4"
      >
        <header>
          <h1 className="font-semibold text-lg">ShiftPane</h1>
          <p className="text-ink-muted text-sm">
            {paired
              ? 'Pairing token received. Connecting…'
              : 'Scan the QR code in the ShiftPane desktop app to pair.'}
          </p>
        </header>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Split</legend>
          {(Object.keys(SPLIT_PRESETS) as SplitPreset[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={preset === key}
              onClick={() => setPreset(key)}
              className="rounded-full border border-border px-3 py-1.5 text-sm aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink"
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </fieldset>
      </section>
    </main>
  )
}
