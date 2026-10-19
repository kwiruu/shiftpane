import { type PcData, type TableEditing, TableView, useElementSize } from '@shiftpane/board'
import type { Rect, Size } from '@shiftpane/layout'
import { type Board, type Insets, MAX_CROP } from '@shiftpane/protocol'
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'

/** The phone's case around the screen, in CSS pixels at full size. */
const BEZEL = 12

/** The screen is never cropped smaller than this along either side, in CSS pixels. */
const SMALLEST_AREA = 160

type Side = keyof Insets

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const

const HATCH = 'repeating-linear-gradient(45deg, rgb(255 255 255 / 0.08) 0 2px, transparent 2px 9px)'

/** The crop frame and its handles appear while the cursor is over the phone. */
const REVEAL_ON_HOVER = 'opacity-0 group-hover/screen:opacity-100'

const horizontal = (side: Side) => side === 'left' || side === 'right'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

type Drag =
  | { kind: 'edge'; side: Side; start: number; from: number }
  | { kind: 'move'; x: number; y: number; from: Insets }

/**
 * One table as the phone shows it: the phone's screen at its own CSS size, scaled to fit, with
 * the monitor area and the widget area where the phone puts them. Widgets are picked and
 * dragged here. Around the whole layout is the crop frame: its handles keep part of the screen
 * clear (for a camera, say), and dragging its edge or the PC's screen moves everything.
 */
export function PhonePreview({
  board,
  current,
  screen,
  area,
  monitor,
  stream,
  panel,
  crop,
  onCrop,
  data,
  editing,
}: {
  board: Board
  current: number
  /** The whole screen in CSS pixels. */
  screen: Size
  /** What is left of it inside the crop. */
  area: Rect
  /** Where the PC's monitor goes, or null when the widgets fill the area. */
  monitor: Rect | null
  /** The monitor's resolution, for its label. */
  stream: Size | null
  /** Where the widgets go, or null when the split shows only the PC's screen. */
  panel: Rect | null
  /** Space kept clear at the screen's edges, as the screen is held now. */
  crop: Insets
  onCrop: (crop: Insets) => void
  data: PcData
  editing: TableEditing
}) {
  const stage = useRef<HTMLDivElement>(null)
  const room = useElementSize(stage)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState<Side | 'move' | null>(null)
  const table = board.tables[current]
  const { width, height } = screen
  const scale = Math.min(1, room.width / (width + BEZEL * 2), room.height / (height + BEZEL * 2))
  // Lines and handles keep their on-screen size however small the phone is drawn.
  const ui = scale > 0 ? 1 / scale : 1
  const cropped = SIDES.some((side) => crop[side] > 0)

  /** Moves one edge of the crop to `value` in from the screen's edge, within what fits. */
  const cropTo = (side: Side, value: number) => {
    const length = horizontal(side) ? width : height
    const most = Math.min(MAX_CROP, length - crop[OPPOSITE[side]] - SMALLEST_AREA)
    const next = Math.round(clamp(value, 0, Math.max(0, most)))
    if (next !== crop[side]) onCrop({ ...crop, [side]: next })
  }

  /** Moves the whole cropped area by `dx`, `dy`, keeping its size. */
  const moveBy = (from: Insets, dx: number, dy: number) => {
    const x = Math.round(
      clamp(
        dx,
        Math.max(-from.left, from.right - MAX_CROP),
        Math.min(from.right, MAX_CROP - from.left),
      ),
    )
    const y = Math.round(
      clamp(
        dy,
        Math.max(-from.top, from.bottom - MAX_CROP),
        Math.min(from.bottom, MAX_CROP - from.top),
      ),
    )
    const next = {
      top: from.top + y,
      right: from.right - x,
      bottom: from.bottom - y,
      left: from.left + x,
    }
    if (SIDES.some((side) => next[side] !== crop[side])) onCrop(next)
  }

  const start = (event: PointerEvent<HTMLElement>, next: Drag) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = next
    setDragging(next.kind === 'edge' ? next.side : 'move')
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    if (current.kind === 'edge') {
      const { side, from } = current
      const moved = ((horizontal(side) ? event.clientX : event.clientY) - current.start) * ui
      cropTo(side, from + (side === 'left' || side === 'top' ? moved : -moved))
    } else {
      moveBy(current.from, (event.clientX - current.x) * ui, (event.clientY - current.y) * ui)
    }
  }
  const onPointerUp = () => {
    drag.current = null
    setDragging(null)
  }
  const pointer = { onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
  const startMove = (event: PointerEvent<HTMLElement>) =>
    start(event, { kind: 'move', x: event.clientX, y: event.clientY, from: crop })

  /** Arrow keys move the area one pixel, ten with Shift. */
  const onMoveKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 10 : 1
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const by = arrows[event.key]
    if (!by) return
    event.preventDefault()
    event.stopPropagation()
    moveBy(crop, by[0], by[1])
  }

  const place = ({ x, y, width: w, height: h }: Rect) => ({ left: x, top: y, width: w, height: h })

  // The cropped-off screen, hatched: whole strips left and right, between them top and bottom.
  const strips: Record<Side, Rect> = {
    left: { x: 0, y: 0, width: area.x, height },
    right: { x: area.x + area.width, y: 0, width: width - area.x - area.width, height },
    top: { x: area.x, y: 0, width: area.width, height: area.y },
    bottom: {
      x: area.x,
      y: area.y + area.height,
      width: area.width,
      height: height - area.y - area.height,
    },
  }

  const handle = (side: Side) => {
    const across = horizontal(side)
    const long = 40 * ui
    const thick = 7 * ui
    const hit = 24 * ui
    // On the edge of the area, but kept on the screen when nothing is cropped there.
    const inset = thick * 1.5
    const center =
      side === 'left'
        ? { x: area.x, y: area.y + area.height / 2 }
        : side === 'right'
          ? { x: area.x + area.width, y: area.y + area.height / 2 }
          : side === 'top'
            ? { x: area.x + area.width / 2, y: area.y }
            : { x: area.x + area.width / 2, y: area.y + area.height }
    center.x = clamp(center.x, inset, width - inset)
    center.y = clamp(center.y, inset, height - inset)
    const w = across ? hit : long + hit
    const h = across ? long + hit : hit
    // Arrow keys move the edge one pixel, ten with Shift; the arrow pointing inward crops.
    const inward = { left: 'ArrowRight', right: 'ArrowLeft', top: 'ArrowDown', bottom: 'ArrowUp' }
    const outward = { left: 'ArrowLeft', right: 'ArrowRight', top: 'ArrowUp', bottom: 'ArrowDown' }
    return (
      <div
        key={side}
        role="slider"
        aria-label={`Space kept clear on the ${side} of the screen`}
        aria-orientation={across ? 'horizontal' : 'vertical'}
        aria-valuenow={crop[side]}
        aria-valuemin={0}
        aria-valuemax={MAX_CROP}
        tabIndex={0}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1
          if (event.key === inward[side]) cropTo(side, crop[side] + step)
          else if (event.key === outward[side]) cropTo(side, crop[side] - step)
          else return
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) =>
          start(event, {
            kind: 'edge',
            side,
            start: across ? event.clientX : event.clientY,
            from: crop[side],
          })
        }
        {...pointer}
        className={`group pointer-events-auto absolute z-30 grid touch-none place-items-center rounded-full outline-none transition-opacity duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky ${
          dragging ? 'opacity-100' : REVEAL_ON_HOVER
        } ${across ? 'cursor-ew-resize' : 'cursor-ns-resize'}`}
        style={{ left: center.x - w / 2, top: center.y - h / 2, width: w, height: h }}
      >
        <span
          className={`block rounded-full shadow-[0_1px_6px_rgb(0_0_0/0.6)] transition-colors ${
            dragging === side ? 'bg-sky' : 'bg-white group-hover:bg-sky'
          }`}
          style={{ width: across ? thick : long, height: across ? long : thick }}
        />
        {dragging === side && (
          <span
            className="absolute rounded-md bg-sky px-1.5 py-0.5 font-semibold text-white tabular-nums"
            style={{
              fontSize: 12 * ui,
              whiteSpace: 'nowrap',
              ...(across ? { top: -22 * ui } : side === 'top' ? { top: hit } : { bottom: hit }),
            }}
          >
            {crop[side]} px
          </span>
        )}
      </div>
    )
  }

  /** A strip along one edge of the frame that moves the whole area when dragged. */
  const edgeGrip = (side: Side) => {
    const band = 12 * ui
    const rect =
      side === 'left' || side === 'right'
        ? {
            x: (side === 'left' ? area.x : area.x + area.width) - band / 2,
            y: area.y,
            width: band,
            height: area.height,
          }
        : {
            x: area.x,
            y: (side === 'top' ? area.y : area.y + area.height) - band / 2,
            width: area.width,
            height: band,
          }
    return (
      <div
        key={`grip-${side}`}
        aria-hidden
        onPointerDown={startMove}
        {...pointer}
        className="absolute z-20 cursor-move touch-none"
        style={place(rect)}
      />
    )
  }

  const corner = (vertical: 'top' | 'bottom', side: 'left' | 'right') => {
    const size = 16 * ui
    const line = 3 * ui
    return (
      <span
        key={`${vertical}-${side}`}
        className="absolute border-sky"
        style={{
          width: size,
          height: size,
          [vertical]: -line / 2,
          [side]: -line / 2,
          [`border${vertical === 'top' ? 'Top' : 'Bottom'}Width`]: line,
          [`border${side === 'left' ? 'Left' : 'Right'}Width`]: line,
        }}
      />
    )
  }

  return (
    <div ref={stage} className="grid min-h-0 flex-1 place-items-center">
      {table && scale > 0 && (
        <div style={{ width: (width + BEZEL * 2) * scale, height: (height + BEZEL * 2) * scale }}>
          <div
            className="group/screen rounded-[52px] bg-neutral-900 shadow-2xl ring-1 ring-white/10"
            style={{
              width: width + BEZEL * 2,
              height: height + BEZEL * 2,
              padding: BEZEL,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <div className="board relative size-full overflow-hidden rounded-[40px] bg-board text-card-ink">
              {SIDES.filter((side) => crop[side] > 0).map((side) => (
                <div
                  key={side}
                  aria-hidden
                  className="absolute"
                  style={{ ...place(strips[side]), backgroundImage: HATCH }}
                />
              ))}

              {monitor && (
                // biome-ignore lint/a11y/useSemanticElements: a draggable area, not a form control
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="The PC's screen: drag to move the layout"
                  title={cropped ? 'Drag to move the layout' : undefined}
                  onPointerDown={startMove}
                  onKeyDown={onMoveKey}
                  {...pointer}
                  className={`absolute touch-none select-none p-3 outline-none focus-visible:ring-2 focus-visible:ring-sky ${
                    cropped ? 'cursor-move' : ''
                  }`}
                  style={place(monitor)}
                >
                  <div
                    className={`grid size-full place-items-center rounded-[28px] border-2 border-dashed text-center text-white transition-colors ${
                      dragging === 'move' ? 'border-sky/70' : 'border-white/20'
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-2xl tabular-nums tracking-tight">
                        {stream ? `${stream.width} × ${stream.height}` : 'Monitor'}
                      </p>
                      <p className="mt-1 text-sm text-white/50">The PC's screen</p>
                    </div>
                  </div>
                </div>
              )}

              {panel && (
                <div className="absolute" style={{ ...place(panel), padding: board.gap }}>
                  <TableView
                    table={table}
                    gap={board.gap}
                    radius={board.radius}
                    data={data}
                    connected
                    onMediaAction={() => {}}
                    editing={editing}
                  />
                </div>
              )}

              <div
                aria-hidden
                className={`pointer-events-none absolute z-10 border-dashed transition-[opacity,border-color] duration-150 ${
                  dragging ? 'border-sky/80 opacity-100' : `border-white/25 ${REVEAL_ON_HOVER}`
                }`}
                style={{ ...place(area), borderWidth: 1.5 * ui }}
              >
                {corner('top', 'left')}
                {corner('top', 'right')}
                {corner('bottom', 'left')}
                {corner('bottom', 'right')}
              </div>
              {cropped && SIDES.map(edgeGrip)}
              {SIDES.map(handle)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
