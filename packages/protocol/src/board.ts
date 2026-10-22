/**
 * The widget board the phone shows, as both sides parse it.
 *
 * A board is a list of tables. The phone shows one table per screen, on black, and the user
 * scrolls from table to table; each table is its own grid of columns and rows with widgets placed
 * in it. The board is edited in the desktop app, and the PC keeps the copy every phone gets.
 */

import { z } from 'zod'
import { WidgetId } from './widgets.ts'

export const MAX_TABLES = 12
export const MAX_COLUMNS = 6
export const MAX_ROWS = 6
/** One widget per cell of the largest grid. */
export const MAX_TABLE_WIDGETS = MAX_COLUMNS * MAX_ROWS
export const MAX_GAP = 32
export const MAX_RADIUS = 48
/** The most a table can be kept clear of one edge of the screen, in CSS pixels. */
export const MAX_CROP = 320

/** The built-in widgets. Each one is drawn by the phone; some need data from the PC. */
export const WidgetKind = z.enum([
  'clock',
  'analog-clock',
  'calendar',
  'pc-stats',
  'cpu',
  'memory',
  'network',
  'media',
])
export type WidgetKind = z.infer<typeof WidgetKind>

/** A light (white) or dark card. */
export const Tone = z.enum(['light', 'dark'])
export type Tone = z.infer<typeof Tone>

/** Lowercase letters, digits and dashes, such as `clock-2` or `table-1`. */
const BoardId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

const Columns = z.number().int().min(1).max(MAX_COLUMNS)
const Rows = z.number().int().min(1).max(MAX_ROWS)

const Placement = {
  id: BoardId,
  tone: Tone,
  /** Cells the widget spans; narrowed to its table's grid when that has fewer. */
  columns: Columns,
  rows: Rows,
}

/**
 * A widget on a table: a built-in one by its kind, or one installed on the PC (from the
 * marketplace or a folder) by its manifest id. The PC sends phones the installed widgets' views
 * (`widgets.installed`); an installed widget the PC no longer has shows as missing.
 */
export const BoardWidget = z.discriminatedUnion('kind', [
  z.object({ ...Placement, kind: WidgetKind }),
  z.object({ ...Placement, kind: z.literal('installed'), widget: WidgetId }),
])
export type BoardWidget = z.infer<typeof BoardWidget>
export type InstalledBoardWidget = Extract<BoardWidget, { kind: 'installed' }>

export const Table = z.object({
  id: BoardId,
  columns: Columns,
  rows: Rows,
  /** In placement order: each goes in the first free spot, left to right, top to bottom. */
  widgets: z.array(BoardWidget).max(MAX_TABLE_WIDGETS),
})
export type Table = z.infer<typeof Table>

const CropInset = z.number().int().min(0).max(MAX_CROP)

/** How far in from each edge of the screen the phone lays itself out, in CSS pixels. */
export const Insets = z.object({
  top: CropInset,
  right: CropInset,
  bottom: CropInset,
  left: CropInset,
})
export type Insets = z.infer<typeof Insets>

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

export const Board = z
  .object({
    /** Space between widgets and around each table, in CSS pixels. */
    gap: z.number().int().min(0).max(MAX_GAP),
    /** Corner radius of every widget, in CSS pixels. */
    radius: z.number().int().min(0).max(MAX_RADIUS),
    /**
     * Space kept clear at the edges of the phone's screen, such as for a camera cut-out, for
     * each shape of screen; the monitor and the widgets share what is left. Kept as the phone is
     * usually held; a phone turned the other way up uses it turned round, so the space follows
     * the camera. Boards saved before this have none.
     */
    crop: z
      .object({ portrait: Insets, landscape: Insets })
      .default({ portrait: NO_INSETS, landscape: NO_INSETS }),
    tables: z.array(Table).min(1).max(MAX_TABLES),
  })
  .refine(
    (board) => {
      const ids = board.tables.flatMap((table) => [table.id, ...table.widgets.map((w) => w.id)])
      return new Set(ids).size === ids.length
    },
    { message: 'every table and widget needs its own id' },
  )
export type Board = z.infer<typeof Board>
