import { computeSplit, type Rect, SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'
import { useState } from 'react'
import { MonitorView } from './MonitorView.tsx'
import { describeConnection, usePcConnection, usePcStream } from './usePcConnection.ts'
import { useStreamRequest } from './useStreamRequest.ts'
import { useViewport } from './useViewport.ts'

const placeAt = ({ x, y, width, height }: Rect) => ({ left: x, top: y, width, height })

const TONE_DOT = { ok: 'bg-ok', wait: 'bg-warn animate-pulse', bad: 'bg-danger' } as const

const PRESET_LABELS: Record<SplitPreset, string> = {
  monitor: 'Monitor',
  '70-30': '70 / 30',
  '50-50': '50 / 50',
  widgets: 'Widgets',
}

/**
 * Shell: the PC's monitor in the monitor area, and the connection status and split picker in
 * the panel. The widget panel replaces the second pane.
 */
export function App() {
  const viewport = useViewport()
  const [preset, setPreset] = useState<SplitPreset>('70-30')
  const connection = usePcConnection()
  const stream = usePcStream()
  const status = describeConnection(connection)
  const displayAvailable = connection.status === 'connected' && connection.welcome.features.display
  const layout = computeSplit({
    viewport,
    devicePixelRatio: viewport.devicePixelRatio,
    monitorFraction: SPLIT_PRESETS[preset],
  })
  // The PC's virtual monitor follows the split: it appears at the monitor area's size and goes
  // away on the widgets-only split.
  useStreamRequest(layout.stream, viewport, displayAvailable)

  return (
    <main className="relative h-full overflow-hidden bg-surface-sunken text-ink">
      <section
        aria-label="Monitor"
        style={placeAt(layout.monitor)}
        className="absolute overflow-hidden border-border border-r border-b bg-surface"
      >
        {layout.stream && (
          <MonitorView state={stream} wanted={layout.stream} available={displayAvailable} />
        )}
      </section>

      <section
        aria-label="Widgets"
        style={placeAt(layout.panel)}
        className="absolute flex flex-col gap-4 overflow-y-auto p-4"
      >
        <header>
          <h1 className="flex items-center gap-2 font-semibold text-lg">
            <span className={`size-2 rounded-full ${TONE_DOT[status.tone]}`} aria-hidden />
            {status.title}
          </h1>
          <p className="text-ink-muted text-sm" role="status">
            {status.detail}
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
