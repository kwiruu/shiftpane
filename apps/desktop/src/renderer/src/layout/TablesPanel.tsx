import {
  addTable,
  DEFAULT_BOARD,
  moveTable,
  removeTable,
  setLook,
  widgetName,
} from '@shiftpane/board'
import {
  type Board,
  type InstalledWidget,
  MAX_GAP,
  MAX_RADIUS,
  MAX_TABLES,
} from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { Card, Chip } from '../shell/parts.tsx'
import { IconButton, Section, Slider } from './controls.tsx'
import { Inspector } from './Inspector.tsx'
import { TableThumb } from './TableThumb.tsx'

/** A press that moves this far (CSS pixels) is a drag, not a click. */
const DRAG_SLOP = 6

/** The row a widget dragged off the phone preview is over, and whether it has room there. */
export interface SendTarget {
  /** The table, by position. */
  index: number
  fits: boolean
}

/**
 * The board as a whole: its tables in the order the phone scrolls through them, dragged into
 * that order by hand (and onto which a widget from the preview can be dropped), then the table
 * being edited, the widget picked on it, and the look every table shares.
 */
export function TablesPanel({
  board,
  installed,
  current,
  aspect,
  selectedId,
  sendTo,
  onPick,
  onSelect,
  onChange,
}: {
  board: Board
  /** The widgets installed on the PC, for their names. */
  installed: InstalledWidget[]
  /** The table being edited, by position. */
  current: number
  /** Width over height of the widget area, for the thumbnails. */
  aspect: number
  selectedId: string | null
  /** Set while a widget is dragged from the preview and is over one of the rows. */
  sendTo: SendTarget | null
  onPick: (index: number) => void
  onSelect: (widgetId: string | null) => void
  onChange: (board: Board) => void
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const press = useRef<{ index: number; x: number; y: number; dragging: boolean } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const count = board.tables.length

  const onPointerDown = (event: PointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { index, x: event.clientX, y: event.clientY, dragging: false }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const held = press.current
    if (!held) return
    if (!held.dragging) {
      if (Math.hypot(event.clientX - held.x, event.clientY - held.y) < DRAG_SLOP) return
      held.dragging = true
      setDragging(held.index)
      onPick(held.index)
    }
    const over = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-table-index]')
    const to = Number(over?.dataset.tableIndex)
    if (!Number.isInteger(to) || to === held.index) return
    onChange(moveTable(board, held.index, to))
    held.index = to
    setDragging(to)
    onPick(to)
  }

  const onPointerUp = () => {
    const held = press.current
    press.current = null
    setDragging(null)
    // A press that never moved picks the table instead of reordering it.
    if (held && !held.dragging) onPick(held.index)
  }

  const onPointerCancel = () => {
    press.current = null
    setDragging(null)
  }

  /** Enter picks a table; Alt with an arrow moves it, so the order is reachable by keyboard. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onPick(index)
      return
    }
    if (!event.altKey) return
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : index
    if (to === index || to < 0 || to >= count) return
    event.preventDefault()
    onChange(moveTable(board, index, to))
    onPick(to)
  }

  return (
    <Card
      title="Tables"
      icon="tables"
      aside={
        <Chip>
          {count} / {MAX_TABLES}
        </Chip>
      }
      bodyClassName="overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className="border-border border-b p-2">
          <ol className="flex flex-col gap-1">
            {board.tables.map((table, index) => {
              const selected = index === current
              const names = table.widgets.map((widget) => widgetName(widget, installed))
              const receiving = sendTo?.index === index
              const refusing = receiving && !sendTo.fits
              const note = refusing ? 'No room for it here' : names.join(', ') || 'Empty'
              return (
                <li key={table.id}>
                  {/* biome-ignore lint/a11y/useSemanticElements: a row holding its own buttons cannot itself be a button */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Table ${index + 1}, ${index + 1} of ${count}`}
                    data-table-index={index}
                    title="Drag to reorder · drop a widget from the phone here to move it to this table"
                    onPointerDown={(event) => onPointerDown(event, index)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    className={`flex touch-none select-none items-center gap-3 rounded-[0.625rem] p-2 outline-none transition-[scale,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ink/40 ${
                      dragging === index
                        ? 'lifted z-10 scale-[1.02] cursor-grabbing'
                        : `cursor-grab ${selected ? 'lifted' : 'hover:bg-white/[0.035]'}`
                    } ${
                      receiving
                        ? `ring-2 ring-inset ${refusing ? 'ring-warn/70' : 'bg-white/10 ring-white/70'}`
                        : ''
                    }`}
                  >
                    <TableThumb table={table} aspect={aspect} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">
                        Table {index + 1}
                        <span className="ml-1.5 font-mono font-normal text-[11px] text-ink-muted tabular-nums">
                          {table.columns}×{table.rows}
                        </span>
                      </p>
                      <p
                        className={`line-clamp-2 text-xs ${refusing ? 'text-warn' : 'text-ink-muted'}`}
                      >
                        {note}
                      </p>
                    </div>
                    {selected && (
                      <IconButton
                        label={count > 1 ? 'Delete table' : 'Clear table'}
                        icon="trash"
                        tone="danger"
                        onClick={() => {
                          onChange(removeTable(board, table.id))
                          onPick(Math.max(0, index - 1))
                        }}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            disabled={count >= MAX_TABLES}
            onClick={() => {
              onChange(addTable(board, current))
              onPick(current + 1)
            }}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-[0.625rem] border border-border-strong border-dashed text-ink-muted text-sm transition hover:border-ink-faint hover:text-ink disabled:opacity-40"
          >
            <Icon name="plus" className="size-[1.125rem]" />
            New table
          </button>
        </div>

        <Inspector
          board={board}
          installed={installed}
          current={current}
          selectedId={selectedId}
          onChange={onChange}
          onSelect={onSelect}
        />

        <Section title="Every table">
          <Slider
            label="Spacing"
            value={board.gap}
            min={0}
            max={MAX_GAP}
            format={(gap) => (gap === 0 ? 'None' : `${gap} px`)}
            onChange={(gap) => onChange(setLook(board, { gap }))}
          />
          <Slider
            label="Corners"
            value={board.radius}
            min={0}
            max={MAX_RADIUS}
            format={(radius) =>
              radius === 0 ? 'Square' : radius === MAX_RADIUS ? 'Round' : `${radius} px`
            }
            onChange={(radius) => onChange(setLook(board, { radius }))}
          />
          <button
            type="button"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true)
                return
              }
              onChange(DEFAULT_BOARD)
              onPick(0)
              setConfirmReset(false)
            }}
            onBlur={() => setConfirmReset(false)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-danger text-xs transition hover:bg-danger/10"
          >
            <Icon name="reset" className="size-3.5" />
            {confirmReset ? 'Click again to replace every table' : 'Reset to the default tables'}
          </button>
        </Section>
      </div>
    </Card>
  )
}
