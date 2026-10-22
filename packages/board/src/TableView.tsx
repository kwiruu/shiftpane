import type { MediaAction, Table, WidgetAction } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { type PointerEvent, useRef, useState } from 'react'
import type { PcData } from './data.ts'
import { placeTable, widgetName } from './model.ts'
import { WidgetCard } from './WidgetCard.tsx'

/**
 * Where a widget dragged in from outside would land: on a widget, which pushes that one and
 * everything after it along; on an empty cell; or at the end of the table.
 */
export type DropAt =
  | { kind: 'widget'; index: number }
  | { kind: 'cell'; column: number; row: number }
  | { kind: 'end' }

/** In the desktop editor, widgets are picked and dragged instead of used. */
export interface TableEditing {
  selectedId: string | null
  /** A widget was clicked; null for a click on the table around them. */
  onSelect: (widgetId: string | null) => void
  /** A widget was dragged over another: move it from one place in `table.widgets` to the other. */
  onMove: (from: number, to: number) => void
  /** An empty cell was clicked. */
  onAddAt: () => void
  /**
   * A widget is being dragged in from the picker, and this is the slot the pointer is over.
   * The editor hit-tests it from `data-table-root`, `data-widget-index` and `data-cell`.
   */
  dropAt?: DropAt | null
  /**
   * A widget of this table is being dragged and the pointer is at (x, y) in the window. The
   * editor hit-tests it for something outside the table that takes a widget, such as another
   * table's row in its list.
   */
  onDragTo?: (widgetId: string, x: number, y: number) => void
  /** The drag was let go at (x, y). */
  onDrop?: (widgetId: string, x: number, y: number) => void
  /** The drag was called off, so the editor can drop its hint. */
  onDragCancel?: () => void
}

export interface TableViewProps {
  table: Table
  gap: number
  radius: number
  data: PcData
  connected: boolean
  onMediaAction: (action: MediaAction) => void
  onWidgetAction?: (action: WidgetAction) => void
  editing?: TableEditing
}

/** A press that moves this far (CSS pixels) is a drag, not a click. */
const DRAG_SLOP = 6

/**
 * One table: its widgets placed on its grid, filling the box it is given. On the phone the
 * widgets work; in the editor (`editing`) a click selects a widget, a drag moves it to another
 * spot on the table, and empty cells offer to add one.
 */
export function TableView(props: TableViewProps) {
  const { table, gap, radius, data, connected, onMediaAction, onWidgetAction, editing } = props
  const { placed, free } = placeTable(table)
  const dropAt = editing?.dropAt ?? null
  // Anywhere but onto a widget, the new one flows into the first cell with room for it.
  const landing = dropAt && dropAt.kind !== 'widget' ? free[0] : undefined
  const press = useRef<{ widgetId: string; x: number; y: number; dragging: boolean } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>, widgetId: string) => {
    if (!editing) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { widgetId, x: event.clientX, y: event.clientY, dragging: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = press.current
    if (!editing || !current) return
    if (!current.dragging) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_SLOP) return
      current.dragging = true
      setDragging(current.widgetId)
      editing.onSelect(current.widgetId)
    }
    editing.onDragTo?.(current.widgetId, event.clientX, event.clientY)
    const over = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-widget-index]')
    if (over?.dataset.tableId !== table.id) return
    const from = table.widgets.findIndex((item) => item.id === current.widgetId)
    const to = Number(over.dataset.widgetIndex)
    if (Number.isInteger(to) && from !== -1 && to !== from) editing.onMove(from, to)
  }
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = press.current
    press.current = null
    setDragging(null)
    if (!current) return
    if (current.dragging) editing?.onDrop?.(current.widgetId, event.clientX, event.clientY)
    else editing?.onSelect(current.widgetId)
  }
  const onPointerCancel = () => {
    if (press.current?.dragging) editing?.onDragCancel?.()
    press.current = null
    setDragging(null)
  }

  return (
    <div
      className="relative size-full"
      data-table-root={editing ? table.id : undefined}
      onPointerDown={editing ? () => editing.onSelect(null) : undefined}
    >
      <div
        className="grid size-full"
        style={{
          gap,
          gridTemplateColumns: `repeat(${table.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${table.rows}, minmax(0, 1fr))`,
        }}
      >
        {placed.map(({ widget, column, row, columns, rows }) => {
          const selected = editing?.selectedId === widget.id
          const pushed = dropAt?.kind === 'widget' && dropAt.index === table.widgets.indexOf(widget)
          return (
            <div
              key={widget.id}
              data-table-id={table.id}
              data-widget-index={table.widgets.indexOf(widget)}
              title={editing ? widgetName(widget, data.installed) : undefined}
              style={{
                gridColumn: `${column + 1} / span ${columns}`,
                gridRow: `${row + 1} / span ${rows}`,
                borderRadius: radius,
              }}
              onPointerDown={(event) => onPointerDown(event, widget.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              className={`relative min-h-0 min-w-0 transition-[scale,filter] duration-150 ${
                editing ? 'cursor-grab touch-none select-none' : ''
              } ${dragging === widget.id ? 'z-10 scale-[1.03] cursor-grabbing drop-shadow-2xl' : ''} ${
                selected ? 'outline-3 outline-sky outline-offset-3' : ''
              } ${pushed ? 'outline-3 outline-white outline-dashed outline-offset-3' : ''}`}
            >
              <div className={editing ? 'pointer-events-none size-full' : 'size-full'}>
                <WidgetCard
                  widget={widget}
                  radius={radius}
                  data={data}
                  connected={connected}
                  onMediaAction={onMediaAction}
                  onWidgetAction={onWidgetAction}
                />
              </div>
            </div>
          )
        })}
        {editing &&
          free.map(({ column, row }) => (
            <button
              key={`${column}-${row}`}
              type="button"
              aria-label="Add a widget here"
              data-table-id={table.id}
              data-cell={`${column},${row}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={editing.onAddAt}
              style={{
                gridColumn: `${column + 1} / span 1`,
                gridRow: `${row + 1} / span 1`,
                borderRadius: radius,
              }}
              className={`grid min-h-0 place-items-center border-2 border-dashed transition ${
                landing?.column === column && landing.row === row
                  ? 'border-white bg-white/10 text-white'
                  : 'border-white/15 text-white/40 hover:border-white/35 hover:text-white/70'
              }`}
            >
              <Icon name="plus" className="size-6" />
            </button>
          ))}
      </div>
    </div>
  )
}
