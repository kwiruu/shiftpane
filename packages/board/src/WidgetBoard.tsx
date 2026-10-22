import type { Board, MediaAction, WidgetAction } from '@shiftpane/protocol'
import { useEffect, useRef, useState } from 'react'
import type { PcData } from './data.ts'
import { TableView } from './TableView.tsx'

export interface WidgetBoardProps {
  board: Board
  data: PcData
  connected: boolean
  onMediaAction: (action: MediaAction) => void
  /** A button on an installed widget, for the PC to press if the widget may. */
  onWidgetAction?: (action: WidgetAction) => void
}

/** How long the table dots stay after the board stops scrolling. */
const DOTS_MS = 1200

/**
 * The phone's widget board: one table per screen, and the user scrolls from table to table, in
 * portrait and landscape alike. The board is laid out in the desktop app; the phone only shows
 * it. Each table keeps the board's spacing on every side and nothing more: space for a notch or
 * camera is the board's crop, set by hand in the editor.
 */
export function WidgetBoard({
  board,
  data,
  connected,
  onMediaAction,
  onWidgetAction,
}: WidgetBoardProps) {
  const pager = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  const [moving, setMoving] = useState(false)
  const hideDots = useRef<ReturnType<typeof setTimeout>>(undefined)
  const several = board.tables.length > 1
  const index = Math.min(current, board.tables.length - 1)

  useEffect(() => () => clearTimeout(hideDots.current), [])

  const onScroll = () => {
    const element = pager.current
    if (!element || element.clientHeight === 0) return
    setCurrent(Math.round(element.scrollTop / element.clientHeight))
    setMoving(true)
    clearTimeout(hideDots.current)
    hideDots.current = setTimeout(() => setMoving(false), DOTS_MS)
  }

  return (
    <div className="relative size-full">
      <div
        ref={pager}
        onScroll={onScroll}
        className="no-scrollbar size-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {board.tables.map((table, position) => (
          <section
            key={table.id}
            aria-label={`Table ${position + 1} of ${board.tables.length}`}
            className="size-full snap-start snap-always"
            style={{ padding: board.gap }}
          >
            {table.widgets.length === 0 ? (
              <div className="grid size-full place-items-center text-center text-card-muted text-sm">
                <p>
                  This table is empty.
                  <br />
                  Add widgets in the ShiftPane app on your PC.
                </p>
              </div>
            ) : (
              <TableView
                table={table}
                gap={board.gap}
                radius={board.radius}
                data={data}
                connected={connected}
                onMediaAction={onMediaAction}
                onWidgetAction={onWidgetAction}
              />
            )}
          </section>
        ))}
      </div>

      {several && (
        <div
          aria-hidden
          className={`pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 flex-col gap-1.5 transition-opacity duration-300 ${
            moving ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {board.tables.map((table, position) => (
            <span
              key={table.id}
              className={`block w-1.5 rounded-full bg-card-ink transition-all ${
                position === index ? 'h-4 opacity-90' : 'h-1.5 opacity-30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
