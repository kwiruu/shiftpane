import { cropFor, isFlipped, pcWidgetsOn, screenLayout, WidgetBoard } from '@shiftpane/board'
import { type Rect, SPLIT_PRESETS, type SplitLayout } from '@shiftpane/layout'
import { MonitorSource } from '@shiftpane/protocol'
import { useEffect } from 'react'
import {
  describeConnection,
  onPcSource,
  onPcSplit,
  pairWithCode,
  reconnect,
  sendToPc,
  useBoard,
  usePcConnection,
  usePcData,
  usePcStream,
} from './link.ts'
import { Menu } from './Menu.tsx'
import { MonitorView } from './MonitorView.tsx'
import { PairScreen } from './PairScreen.tsx'
import { usePersistentState } from './persist.ts'
import { parseSplit } from './split.ts'
import { useSafeArea } from './useSafeArea.ts'
import { useScreenReport } from './useScreenReport.ts'
import { useScreenTurn } from './useScreenTurn.ts'
import { useStreamRequest } from './useStreamRequest.ts'
import { useViewport } from './useViewport.ts'

const placeAt = ({ x, y, width, height }: Rect) => ({ left: x, top: y, width, height })

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 }

/**
 * Before the page has a size (a background tab, an app still launching), or with a crop that
 * leaves none of it: nothing to lay out.
 */
const NO_LAYOUT: SplitLayout = {
  orientation: 'landscape',
  monitor: NOWHERE,
  panel: NOWHERE,
  stream: null,
  monitorFraction: 0,
}

const parseSource = (saved: unknown): MonitorSource => {
  const parsed = MonitorSource.safeParse(saved)
  return parsed.success ? parsed.data : { kind: 'virtual' }
}

/**
 * Shell: the PC's monitor in the monitor area and the widget board in the panel, with every
 * setting behind the ⋯ button in the corner.
 */
export function App() {
  const viewport = useViewport()
  const safeArea = useSafeArea()
  const turn = useScreenTurn()
  const [preset, setPreset] = usePersistentState('split', parseSplit)
  // The desktop window can pick the split for this phone; it is kept like one picked here.
  useEffect(() => onPcSplit(setPreset), [setPreset])
  const [chosenSource, setSource] = usePersistentState('source', parseSource)
  // The desktop window can pick it too, and it is kept like one picked from the menu.
  useEffect(() => onPcSource(setSource), [setSource])
  const board = useBoard()
  const connection = usePcConnection()
  const stream = usePcStream()
  const pcData = usePcData()
  const status = describeConnection(connection)
  const connected = connection.status === 'connected'
  const checkingCode = connection.status === 'connecting' && connection.checkingCode === true
  const disconnected = connection.status === 'rejected' && connection.reason === 'disconnected'
  const virtualAvailable = connected && connection.welcome.features.display

  // A duplicated monitor that is no longer there (unplugged) falls back to the virtual one.
  const mirrored =
    chosenSource.kind === 'mirror'
      ? pcData.monitors.find((monitor) => monitor.id === chosenSource.displayId)
      : undefined
  const source: MonitorSource =
    chosenSource.kind === 'mirror' && pcData.monitors.length > 0 && !mirrored
      ? { kind: 'virtual' }
      : chosenSource

  // Space kept clear at the screen's edges (the camera, say) comes off first; the monitor and
  // the widgets split what is left, so the PC's monitor is made at the size that is shown.
  const crop = cropFor(board, viewport.width >= viewport.height, isFlipped(turn))
  const screen = screenLayout(viewport, viewport.devicePixelRatio, SPLIT_PRESETS[preset], crop)
  const sized = screen !== null
  const layout = screen?.split ?? NO_LAYOUT
  const canStream = sized && (source.kind === 'mirror' ? connected : virtualAvailable)
  // The PC follows the split: the virtual monitor appears at the monitor area's size (or the
  // chosen real monitor is copied) and the stream stops on the widgets-only split.
  useStreamRequest(layout.stream, viewport, canStream, source)

  // Tell the PC which widgets need its data, again after every (re)connection.
  const sessionId = connected ? connection.welcome.sessionId : null
  // And how this screen is laid out, for the desktop editor's preview.
  useScreenReport(sessionId, viewport, SPLIT_PRESETS[preset], safeArea, turn, source)
  const pcWidgets = pcWidgetsOn(board).join(',')
  useEffect(() => {
    if (sessionId === null) return
    sendToPc({ type: 'widgets.subscribe', widgets: pcWidgets === '' ? [] : pcWidgets.split(',') })
  }, [sessionId, pcWidgets])

  const wanted = mirrored ? { width: mirrored.width, height: mirrored.height } : layout.stream

  return (
    <main className="board relative h-full overflow-hidden bg-board text-card-ink">
      <section
        aria-label="Monitor"
        style={placeAt(layout.monitor)}
        className="absolute overflow-hidden bg-black"
      >
        {layout.stream && wanted && (
          <MonitorView state={stream} wanted={wanted} available={canStream} />
        )}
      </section>

      <section aria-label="Widgets" style={placeAt(layout.panel)} className="absolute">
        {layout.panel.width > 0 && layout.panel.height > 0 && (
          <WidgetBoard
            board={board}
            data={pcData}
            connected={connected}
            onMediaAction={(action) => sendToPc({ type: 'media.control', action })}
          />
        )}
      </section>

      <Menu
        status={status}
        preset={preset}
        onPreset={setPreset}
        source={source}
        onSource={setSource}
        monitors={pcData.monitors}
        virtualAvailable={virtualAvailable}
        connected={connected}
      />

      {(connection.status === 'unpaired' || checkingCode || disconnected) && (
        <PairScreen
          status={status}
          checking={checkingCode}
          disconnected={disconnected}
          onCode={pairWithCode}
          onReconnect={reconnect}
        />
      )}
    </main>
  )
}
