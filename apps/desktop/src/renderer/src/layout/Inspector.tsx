import {
  addWidget,
  newId,
  type PcData,
  placeTable,
  removeWidget,
  sendWidget,
  setTableGrid,
  updateWidget,
  WIDGET_KINDS,
  WidgetCard,
} from '@shiftpane/board'
import {
  type Board,
  MAX_COLUMNS,
  MAX_ROWS,
  type Tone,
  type WidgetKind,
  WidgetKind as WidgetKinds,
} from '@shiftpane/protocol'
import type { RefObject } from 'react'
import { Row, Section, Segmented, Stepper } from './controls.tsx'

const TONES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly { value: Tone; label: string }[]

/**
 * The table being edited and the widget picked on it: the table's grid, the widget's size,
 * card and table, and the widgets that can be added.
 */
export function Inspector({
  board,
  current,
  selectedId,
  data,
  addSection,
  onChange,
  onSelect,
  onPick,
}: {
  board: Board
  /** The table being edited, by position. */
  current: number
  selectedId: string | null
  data: PcData
  /** Scrolled into view when an empty cell in the preview is clicked. */
  addSection: RefObject<HTMLDivElement | null>
  onChange: (board: Board) => void
  onSelect: (widgetId: string | null) => void
  /** Shows another table (a widget moved or was added there). */
  onPick: (index: number) => void
}) {
  const table = board.tables[current]
  if (!table) return null
  const widget = table.widgets.find((item) => item.id === selectedId)
  const hidden = placeTable(table).overflow

  const add = (kind: WidgetKind) => {
    const id = newId(board, kind)
    const added = addWidget(board, table.id, kind)
    if (added.board === board) return
    onChange(added.board)
    onPick(added.board.tables.findIndex((item) => item.id === added.tableId))
    onSelect(id)
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-panel bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <Section title={`Table ${current + 1}`}>
          <Stepper
            label="Columns"
            value={table.columns}
            min={1}
            max={MAX_COLUMNS}
            onChange={(columns) => onChange(setTableGrid(board, table.id, { columns }))}
          />
          <Stepper
            label="Rows"
            value={table.rows}
            min={1}
            max={MAX_ROWS}
            onChange={(rows) => onChange(setTableGrid(board, table.id, { rows }))}
          />
          {hidden.length > 0 && (
            <div className="mt-2 rounded-lg bg-flame/10 p-3 text-xs">
              <p className="text-flame">
                No room for {hidden.length === 1 ? 'this widget' : 'these widgets'}. Add a row or
                column, or move {hidden.length === 1 ? 'it' : 'them'} to another table.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {hidden.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={`rounded-md px-2 py-1 font-medium ${
                      item.id === selectedId ? 'bg-flame text-white' : 'bg-surface-raised'
                    }`}
                  >
                    {WIDGET_KINDS[item.kind].name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>

        {widget ? (
          <Section
            title={WIDGET_KINDS[widget.kind].name}
            action={
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="text-ink-muted text-xs hover:text-ink"
              >
                Deselect
              </button>
            }
          >
            <Stepper
              label="Width"
              value={Math.min(widget.columns, table.columns)}
              min={1}
              max={table.columns}
              onChange={(columns) =>
                onChange(updateWidget(board, table.id, widget.id, { columns }))
              }
            />
            <Stepper
              label="Height"
              value={Math.min(widget.rows, table.rows)}
              min={1}
              max={table.rows}
              onChange={(rows) => onChange(updateWidget(board, table.id, widget.id, { rows }))}
            />
            <Row label="Card">
              <Segmented
                label="Card colour"
                options={TONES}
                value={widget.tone}
                onChange={(tone) => onChange(updateWidget(board, table.id, widget.id, { tone }))}
              />
            </Row>
            {board.tables.length > 1 && (
              <Row label="Table">
                <div className="flex flex-wrap justify-end gap-1">
                  {board.tables.map((other, index) => (
                    <button
                      key={other.id}
                      type="button"
                      aria-pressed={index === current}
                      title={index === current ? 'On this table' : `Move to table ${index + 1}`}
                      onClick={() => {
                        if (index === current) return
                        onChange(sendWidget(board, table.id, widget.id, other.id))
                        onPick(index)
                      }}
                      className={`grid size-7 place-items-center rounded-md font-semibold text-xs tabular-nums transition ${
                        index === current
                          ? 'bg-accent text-accent-ink'
                          : 'border border-border hover:border-accent'
                      }`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </Row>
            )}
            <button
              type="button"
              onClick={() => {
                onSelect(null)
                onChange(removeWidget(board, table.id, widget.id))
              }}
              className="mt-3 w-full rounded-lg border border-border py-2 text-danger text-sm transition hover:border-danger"
            >
              Remove widget
            </button>
          </Section>
        ) : (
          <Section title="Widget">
            <p className="text-ink-muted text-sm">
              Click a widget on the phone to change its size and card, or drag it to another spot.
            </p>
          </Section>
        )}

        <div ref={addSection}>
          <Section title={`Add to table ${current + 1}`}>
            <div className="grid grid-flow-row-dense grid-cols-2 gap-x-2.5 gap-y-3">
              {WidgetKinds.options.map((kind) => {
                const info = WIDGET_KINDS[kind]
                const wide = info.columns === 2
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => add(kind)}
                    title={info.description}
                    className={`group text-left ${wide ? 'col-span-2' : ''}`}
                  >
                    <div
                      inert
                      className={`board pointer-events-none w-full overflow-hidden rounded-xl bg-board p-1 transition group-hover:ring-2 group-hover:ring-accent ${
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
                    <p className="mt-1 font-medium text-xs">{info.name}</p>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-ink-muted text-xs">
              A widget that does not fit starts a new table after this one.
            </p>
          </Section>
        </div>
      </div>
    </aside>
  )
}
