import { placeTable, setTableGrid, WIDGET_KINDS } from '@shiftpane/board'
import { type Board, MAX_COLUMNS, MAX_ROWS } from '@shiftpane/protocol'
import { Section, Stepper } from './controls.tsx'

/**
 * The table being edited: its grid, and the widgets that no longer fit on it. A section, not a
 * card of its own: it sits under the table list it belongs to. The widget picked on the phone
 * is edited in the "Add a widget" card (`WidgetEditor`).
 */
export function Inspector({
  board,
  current,
  selectedId,
  onChange,
  onSelect,
}: {
  board: Board
  /** The table being edited, by position. */
  current: number
  selectedId: string | null
  onChange: (board: Board) => void
  onSelect: (widgetId: string | null) => void
}) {
  const table = board.tables[current]
  if (!table) return null
  const hidden = placeTable(table).overflow

  return (
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
        <div className="mt-2 rounded-[0.625rem] border border-warn/25 bg-warn/[0.06] p-3 text-xs">
          <p className="text-warn">
            No room for {hidden.length === 1 ? 'this widget' : 'these widgets'}. Add a row or
            column, or drag {hidden.length === 1 ? 'it' : 'them'} off this table.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hidden.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`rounded-md px-2 py-1 font-medium ${
                  item.id === selectedId ? 'lifted text-ink' : 'raised text-ink-soft'
                }`}
              >
                {WIDGET_KINDS[item.kind].name}
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}
