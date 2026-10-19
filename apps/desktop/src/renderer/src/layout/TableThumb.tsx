import { placeTable } from '@shiftpane/board'
import type { Table } from '@shiftpane/protocol'

/** The thumbnail fits inside this box, in CSS pixels, so a wide screen leaves room for the text. */
const BOX = { width: 64, height: 56 }

/** A table drawn small: light and dark blocks where its widgets go, dashes where cells are free. */
export function TableThumb({ table, aspect }: { table: Table; aspect: number }) {
  const { placed, free } = placeTable(table)
  return (
    <div
      aria-hidden
      className="grid shrink-0 gap-[3px] rounded-md bg-black p-[3px] ring-1 ring-white/10"
      style={{
        width: Math.min(BOX.width, BOX.height * aspect),
        aspectRatio: aspect,
        gridTemplateColumns: `repeat(${table.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${table.rows}, minmax(0, 1fr))`,
      }}
    >
      {placed.map(({ widget, column, row, columns, rows }) => (
        <span
          key={widget.id}
          className={`rounded-[3px] ${widget.tone === 'light' ? 'bg-white/90' : 'bg-white/25'}`}
          style={{
            gridColumn: `${column + 1} / span ${columns}`,
            gridRow: `${row + 1} / span ${rows}`,
          }}
        />
      ))}
      {free.map(({ column, row }) => (
        <span
          key={`${column}-${row}`}
          className="rounded-[3px] border border-white/15 border-dashed"
          style={{ gridColumn: column + 1, gridRow: row + 1 }}
        />
      ))}
    </div>
  )
}
