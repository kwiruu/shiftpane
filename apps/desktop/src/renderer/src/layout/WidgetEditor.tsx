import { removeWidget, updateWidget, WIDGET_KINDS } from '@shiftpane/board'
import type { Board, Tone } from '@shiftpane/protocol'
import { Button } from '../shell/parts.tsx'
import { Row, Section, Segmented, Stepper } from './controls.tsx'

const TONES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly { value: Tone; label: string }[]

/**
 * The widget picked on the phone: its size, its card and a way to remove it. It sits at the top
 * of the "Add a widget" card and is empty until a widget is picked.
 */
export function WidgetEditor({
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
  const widget = table?.widgets.find((item) => item.id === selectedId)
  if (!table || !widget) return null

  return (
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
        onChange={(columns) => onChange(updateWidget(board, table.id, widget.id, { columns }))}
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
      <Button
        tone="danger"
        icon="trash"
        size="md"
        onClick={() => {
          onSelect(null)
          onChange(removeWidget(board, table.id, widget.id))
        }}
        className="mt-3 w-full"
      >
        Remove widget
      </Button>
    </Section>
  )
}
