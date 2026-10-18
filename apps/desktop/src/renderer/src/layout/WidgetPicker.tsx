import { type PcData, WIDGET_KINDS, WidgetCard } from '@shiftpane/board'
import { type WidgetKind, WidgetKind as WidgetKinds } from '@shiftpane/protocol'
import { type PointerEvent, type ReactNode, type RefObject, useRef, useState } from 'react'
import { Card } from '../shell/parts.tsx'

/** A press that moves this far (CSS pixels) is a drag, not a click. */
const DRAG_SLOP = 6

/** The ghost that follows the pointer, in CSS pixels. */
const GHOST_WIDTH = 116

interface Drag {
  kind: WidgetKind
  x: number
  y: number
  dragging: boolean
}

/**
 * Every widget that can go on a table, each shown live. Clicking one adds it to the table being
 * edited; dragging one onto the phone drops it where the pointer is. The drag is tracked here
 * and hit-tested by the editor, which owns the board. `editor` is shown above the gallery: the
 * settings of the widget picked on the phone.
 */
export function WidgetPicker({
  data,
  editor,
  tableNumber,
  gridRef,
  onAdd,
  onDragTo,
  onDrop,
  onCancel,
}: {
  data: PcData
  /** The picked widget's settings, or null when none is picked. Stays put while the gallery scrolls. */
  editor?: ReactNode
  /** The table a widget lands on, by position, for the hint. */
  tableNumber: number
  /** Scrolled into view when an empty cell in the preview is clicked. */
  gridRef: RefObject<HTMLDivElement | null>
  onAdd: (kind: WidgetKind) => void
  /** The pointer moved while dragging a widget out of the picker. */
  onDragTo: (x: number, y: number) => void
  /** The drag ended over this point; the editor decides where it lands. */
  onDrop: (kind: WidgetKind, x: number, y: number) => void
  /** The drag was called off, so the editor can drop its hint. */
  onCancel: () => void
}) {
  const press = useRef<Drag | null>(null)
  /** A drag just ended, so the click the browser sends afterwards is not an "add this one". */
  const dropped = useRef(false)
  const [drag, setDrag] = useState<Drag | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>, kind: WidgetKind) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { kind, x: event.clientX, y: event.clientY, dragging: false }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = press.current
    if (!current) return
    if (!current.dragging) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_SLOP) return
      current.dragging = true
    }
    current.x = event.clientX
    current.y = event.clientY
    setDrag({ ...current })
    onDragTo(event.clientX, event.clientY)
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = press.current
    press.current = null
    setDrag(null)
    if (!current?.dragging) return
    // The click that follows this drag is not a click on the widget; `onClick` swallows it.
    dropped.current = true
    onDrop(current.kind, event.clientX, event.clientY)
  }

  const onPointerCancel = () => {
    press.current = null
    setDrag(null)
    onCancel()
  }

  const ghost = drag?.dragging ? drag.kind : null
  const ghostWide = ghost ? WIDGET_KINDS[ghost].columns === 2 : false

  return (
    <Card title="Add a widget" icon="widget-add" bodyClassName="overflow-hidden">
      {editor}
      <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
        <div className="grid grid-flow-row-dense grid-cols-2 gap-x-2.5 gap-y-3">
          {WidgetKinds.options.map((kind) => {
            const info = WIDGET_KINDS[kind]
            const wide = info.columns === 2
            return (
              <button
                key={kind}
                type="button"
                title={`${info.description} · drag it onto the phone, or click to add it`}
                onPointerDown={(event) => onPointerDown(event, kind)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onClick={() => {
                  if (dropped.current) dropped.current = false
                  else onAdd(kind)
                }}
                className={`group touch-none select-none text-left ${wide ? 'col-span-2' : ''} ${
                  drag?.dragging && drag.kind === kind ? 'opacity-40' : ''
                }`}
              >
                <div
                  inert
                  className={`board pointer-events-none w-full overflow-hidden rounded-xl bg-board p-1 ring-1 ring-border transition group-hover:ring-2 group-hover:ring-ink-muted ${
                    wide ? 'aspect-[2.2/1]' : 'aspect-square'
                  }`}
                >
                  <WidgetCard
                    widget={{ kind, tone: info.tone }}
                    radius={14}
                    data={data}
                    connected
                    onMediaAction={() => {}}
                  />
                </div>
                <p className="mt-1.5 cursor-grab font-medium text-ink-soft text-xs group-hover:text-ink">
                  {info.name}
                </p>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-ink-muted text-xs">
          Drag one onto the phone, or click to put it on table {tableNumber}. A widget that does not
          fit starts a new table.
        </p>
      </div>

      {ghost && drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.x,
            top: drag.y,
            translate: '-50% -50%',
            width: ghostWide ? GHOST_WIDTH * 1.6 : GHOST_WIDTH,
          }}
        >
          <div
            inert
            className="board overflow-hidden rounded-xl bg-board p-1 opacity-90 shadow-[0_18px_50px_rgb(0_0_0/0.7)] ring-2 ring-white/70"
            style={{ aspectRatio: ghostWide ? '2.2 / 1' : '1 / 1' }}
          >
            <WidgetCard
              widget={{ kind: ghost, tone: WIDGET_KINDS[ghost].tone }}
              radius={14}
              data={data}
              connected
              onMediaAction={() => {}}
            />
          </div>
        </div>
      )}
    </Card>
  )
}
