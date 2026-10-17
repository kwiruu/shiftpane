import {
  addTable,
  DEFAULT_BOARD,
  Icon,
  moveTable,
  removeTable,
  setLook,
  WIDGET_KINDS,
} from '@shiftpane/board'
import { type Board, MAX_GAP, MAX_RADIUS, MAX_TABLES } from '@shiftpane/protocol'
import { useState } from 'react'
import { IconButton, Section, Slider } from './controls.tsx'
import { TableThumb } from './TableThumb.tsx'

/**
 * The board as a whole: its tables in the order the phone scrolls through them, and the look
 * every table shares.
 */
export function TablesPanel({
  board,
  current,
  aspect,
  onPick,
  onChange,
}: {
  board: Board
  /** The table being edited, by position. */
  current: number
  /** Width over height of the widget area, for the thumbnails. */
  aspect: number
  onPick: (index: number) => void
  onChange: (board: Board) => void
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const count = board.tables.length

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-panel bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <Section
          title="Tables"
          action={
            <span className="text-ink-muted text-xs tabular-nums">
              {count} of {MAX_TABLES}
            </span>
          }
        >
          <ol className="flex flex-col gap-1.5">
            {board.tables.map((table, index) => {
              const selected = index === current
              const names = table.widgets.map((widget) => WIDGET_KINDS[widget.kind].name)
              return (
                <li key={table.id}>
                  {/* biome-ignore lint/a11y/useSemanticElements: a row holding its own buttons cannot itself be a button */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => onPick(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onPick(index)
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 outline-none transition focus-visible:ring-2 focus-visible:ring-accent ${
                      selected
                        ? 'bg-surface-raised ring-1 ring-accent/60'
                        : 'hover:bg-surface-raised/60'
                    }`}
                  >
                    <TableThumb table={table} aspect={aspect} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">
                        Table {index + 1}
                        <span className="ml-1.5 font-normal text-ink-muted text-xs tabular-nums">
                          {table.columns}×{table.rows}
                        </span>
                      </p>
                      <p className="line-clamp-2 text-ink-muted text-xs">
                        {names.length > 0 ? names.join(', ') : 'Empty'}
                      </p>
                    </div>
                    {selected && (
                      <div className="flex shrink-0 flex-col">
                        <IconButton
                          label="Move up"
                          icon="chevron-up"
                          disabled={index === 0}
                          onClick={() => {
                            onChange(moveTable(board, index, index - 1))
                            onPick(index - 1)
                          }}
                        />
                        <IconButton
                          label="Move down"
                          icon="chevron-down"
                          disabled={index === count - 1}
                          onClick={() => {
                            onChange(moveTable(board, index, index + 1))
                            onPick(index + 1)
                          }}
                        />
                        <IconButton
                          label={count > 1 ? 'Delete table' : 'Clear table'}
                          icon="close"
                          tone="danger"
                          onClick={() => {
                            onChange(removeTable(board, table.id))
                            onPick(Math.max(0, index - 1))
                          }}
                        />
                      </div>
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
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border border-dashed py-2 text-ink-muted text-sm transition hover:border-accent hover:text-ink disabled:opacity-40"
          >
            <Icon name="plus" className="size-4" />
            New table
          </button>
        </Section>

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
            className="mt-3 w-full rounded-lg py-2 text-danger text-xs hover:bg-surface-sunken"
          >
            {confirmReset ? 'Click again to replace every table' : 'Reset to the default tables'}
          </button>
        </Section>
      </div>
    </aside>
  )
}
