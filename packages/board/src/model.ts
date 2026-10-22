import {
  Board,
  type BoardWidget,
  type Insets,
  type InstalledWidget,
  MAX_COLUMNS,
  MAX_CROP,
  MAX_GAP,
  MAX_RADIUS,
  MAX_ROWS,
  MAX_TABLE_WIDGETS,
  MAX_TABLES,
  MEDIA_WIDGET,
  NO_INSETS,
  PC_STATS_WIDGET,
  type ScreenTurn,
  type Table,
  type Tone,
  type WidgetKind,
} from '@shiftpane/protocol'

/**
 * Editing the widget board. The board's shape is defined in `@shiftpane/protocol` because it
 * travels between the phone and the PC; everything here is plain data and pure functions, so
 * the editor is tested without a browser.
 */

interface KindInfo {
  name: string
  description: string
  /** The PC widget it needs data from, or null when it runs on the phone alone. */
  pcWidget: string | null
  /** The tone a newly added widget of this kind gets. */
  tone: Tone
  /** Columns a newly added widget spans: wide widgets start two cells wide. */
  columns: 1 | 2
}

export const WIDGET_KINDS: Record<WidgetKind, KindInfo> = {
  'analog-clock': {
    name: 'Analog clock',
    description: 'A round clock face',
    pcWidget: null,
    tone: 'light',
    columns: 1,
  },
  clock: {
    name: 'Clock',
    description: 'The time and how far the day is',
    pcWidget: null,
    tone: 'dark',
    columns: 1,
  },
  calendar: {
    name: 'Calendar',
    description: 'Today, this week or the month',
    pcWidget: null,
    tone: 'light',
    columns: 1,
  },
  media: {
    name: 'Now playing',
    description: 'Control what the PC plays',
    pcWidget: MEDIA_WIDGET,
    tone: 'dark',
    columns: 2,
  },
  'pc-stats': {
    name: 'PC overview',
    description: 'CPU, memory, GPU and network',
    pcWidget: PC_STATS_WIDGET,
    tone: 'light',
    columns: 2,
  },
  cpu: {
    name: 'CPU',
    description: "The PC's processor load",
    pcWidget: PC_STATS_WIDGET,
    tone: 'light',
    columns: 1,
  },
  memory: {
    name: 'Memory',
    description: 'RAM in use on the PC',
    pcWidget: PC_STATS_WIDGET,
    tone: 'light',
    columns: 1,
  },
  network: {
    name: 'Network',
    description: 'Download and upload speed',
    pcWidget: PC_STATS_WIDGET,
    tone: 'dark',
    columns: 2,
  },
}

const widget = (id: string, kind: WidgetKind, tone: Tone, columns = 1, rows = 1): BoardWidget => ({
  id,
  kind,
  tone,
  columns,
  rows,
})

/** A widget installed on the PC, about to be put on a table. */
export interface NewInstalledWidget {
  kind: 'installed'
  /** Its manifest id. */
  widget: string
  tone: Tone
  /** Columns it starts out spanning. */
  columns: 1 | 2
}

/** What a new board widget is: a built-in kind, or a widget installed on the PC. */
export type NewWidget = WidgetKind | NewInstalledWidget

/**
 * How an installed widget starts out on a table: dark, and two cells wide when it has no small
 * layout to fit in one.
 */
export function newInstalledWidget(installed: {
  id: string
  sizes: readonly InstalledWidget['sizes'][number][]
}): NewInstalledWidget {
  return {
    kind: 'installed',
    widget: installed.id,
    tone: 'dark',
    columns: installed.sizes.includes('small') ? 1 : 2,
  }
}

/** A board widget's name: its kind's, or the installed widget's own, or its id while the PC hasn't said. */
export function widgetName(item: BoardWidget, installed: readonly InstalledWidget[]): string {
  if (item.kind !== 'installed') return WIDGET_KINDS[item.kind].name
  return installed.find((found) => found.id === item.widget)?.name ?? item.widget
}

export const DEFAULT_BOARD: Board = {
  gap: 12,
  radius: 28,
  crop: { portrait: NO_INSETS, landscape: NO_INSETS },
  // Four tables of one row each: a pair of small widgets, another pair, then one wide widget
  // apiece, so a phone scrolls through them one screenful at a time.
  tables: [
    {
      id: 'table-1',
      columns: 2,
      rows: 1,
      widgets: [widget('calendar-1', 'calendar', 'light'), widget('cpu-1', 'cpu', 'light')],
    },
    {
      id: 'table-2',
      columns: 2,
      rows: 1,
      widgets: [
        widget('memory-1', 'memory', 'light'),
        widget('analog-clock-1', 'analog-clock', 'light'),
      ],
    },
    {
      id: 'table-3',
      columns: 2,
      rows: 1,
      widgets: [widget('network-1', 'network', 'dark', 2)],
    },
    {
      id: 'table-4',
      columns: 2,
      rows: 1,
      widgets: [widget('pc-stats-1', 'pc-stats', 'light', 2)],
    },
  ],
}

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))

// ---------------------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------------------

export interface Placed {
  widget: BoardWidget
  /** Zero-based cell of the widget's top-left corner. */
  column: number
  row: number
  /** Cells it covers: its own span, narrowed to the table's grid. */
  columns: number
  rows: number
}

export interface Placement {
  placed: Placed[]
  /** Widgets with no room left on the table, in order. They are kept but not shown. */
  overflow: BoardWidget[]
  /** Cells nothing covers, row by row. */
  free: { column: number; row: number }[]
}

/**
 * Where each widget of a table goes: in order, each takes the first spot it fits, scanning
 * rows top to bottom and cells left to right (CSS grid's dense packing). A widget that fits
 * nowhere overflows.
 */
export function placeTable(table: Pick<Table, 'columns' | 'rows' | 'widgets'>): Placement {
  const taken = Array.from({ length: table.rows }, () => Array<boolean>(table.columns).fill(false))
  const isFree = (column: number, row: number, columns: number, rows: number) => {
    for (let r = row; r < row + rows; r += 1) {
      for (let c = column; c < column + columns; c += 1) if (taken[r]?.[c] !== false) return false
    }
    return true
  }
  const placed: Placed[] = []
  const overflow: BoardWidget[] = []
  for (const item of table.widgets) {
    const columns = Math.min(item.columns, table.columns)
    const rows = Math.min(item.rows, table.rows)
    let spot: { column: number; row: number } | null = null
    for (let row = 0; row + rows <= table.rows && !spot; row += 1) {
      for (let column = 0; column + columns <= table.columns; column += 1) {
        if (isFree(column, row, columns, rows)) {
          spot = { column, row }
          break
        }
      }
    }
    if (!spot) {
      overflow.push(item)
      continue
    }
    for (let r = spot.row; r < spot.row + rows; r += 1) {
      for (let c = spot.column; c < spot.column + columns; c += 1) {
        const line = taken[r]
        if (line) line[c] = true
      }
    }
    placed.push({ widget: item, ...spot, columns, rows })
  }
  const free: { column: number; row: number }[] = []
  taken.forEach((line, row) => {
    line.forEach((cell, column) => {
      if (!cell) free.push({ column, row })
    })
  })
  return { placed, overflow, free }
}

// ---------------------------------------------------------------------------------------
// the board as a whole
// ---------------------------------------------------------------------------------------

/** Changes the board-wide look: the gap between widgets and their corner radius. */
export function setLook(board: Board, patch: Partial<Pick<Board, 'gap' | 'radius'>>): Board {
  return {
    ...board,
    gap: clampInt(patch.gap ?? board.gap, 0, MAX_GAP),
    radius: clampInt(patch.radius ?? board.radius, 0, MAX_RADIUS),
  }
}

/** The phone is held the other way up from usual: upside down, or on its other side. */
export const isFlipped = (turn: ScreenTurn | undefined) => turn?.endsWith('-secondary') ?? false

const turnRound = (insets: Insets): Insets => ({
  top: insets.bottom,
  right: insets.left,
  bottom: insets.top,
  left: insets.right,
})

/**
 * The space kept clear at the edges of a screen of this shape, as the screen is held now: the
 * saved crop, turned round when the phone is the other way up, so it stays on the camera's
 * side.
 */
export function cropFor(board: Board, landscape: boolean, flipped: boolean): Insets {
  const crop = board.crop[landscape ? 'landscape' : 'portrait']
  return flipped ? turnRound(crop) : crop
}

/** Sets the crop for a screen of this shape, given as the screen is held now. */
export function setCrop(board: Board, landscape: boolean, flipped: boolean, crop: Insets): Board {
  const clean = (value: number) => clampInt(value, 0, MAX_CROP)
  const held = {
    top: clean(crop.top),
    right: clean(crop.right),
    bottom: clean(crop.bottom),
    left: clean(crop.left),
  }
  const shape = landscape ? 'landscape' : 'portrait'
  return { ...board, crop: { ...board.crop, [shape]: flipped ? turnRound(held) : held } }
}

/**
 * The PC widgets the board needs data for, for `widgets.subscribe`: the built-in ones its
 * widgets read, and every installed widget on it.
 */
export function pcWidgetsOn(board: Board): string[] {
  const ids = board.tables
    .flatMap((table) => table.widgets)
    .map((item) => (item.kind === 'installed' ? item.widget : WIDGET_KINDS[item.kind].pcWidget))
    .filter((id): id is string => id !== null)
  return [...new Set(ids)].sort()
}

/** Reads a saved board, or the default when there is none or it no longer parses. */
export function parseBoard(saved: unknown): Board {
  const parsed = Board.safeParse(saved)
  return parsed.success ? parsed.data : DEFAULT_BOARD
}

/** `prefix-N` with the smallest N no table or widget on the board uses yet. */
export function newId(board: Board, prefix: string): string {
  const used = new Set(
    board.tables.flatMap((table) => [table.id, ...table.widgets.map((item) => item.id)]),
  )
  let n = 1
  while (used.has(`${prefix}-${n}`)) n += 1
  return `${prefix}-${n}`
}

// ---------------------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------------------

/** Adds an empty two-by-two table right after the one at `index`. */
export function addTable(board: Board, index: number): Board {
  if (board.tables.length >= MAX_TABLES) return board
  const tables = [...board.tables]
  tables.splice(index + 1, 0, { id: newId(board, 'table'), columns: 2, rows: 2, widgets: [] })
  return { ...board, tables }
}

/** Removes a table; removing the only one leaves a single empty table instead. */
export function removeTable(board: Board, id: string): Board {
  const tables = board.tables.filter((table) => table.id !== id)
  if (tables.length === board.tables.length) return board
  if (tables.length > 0) return { ...board, tables }
  return { ...board, tables: [{ id: 'table-1', columns: 2, rows: 2, widgets: [] }] }
}

export function moveTable(board: Board, from: number, to: number): Board {
  const tables = moveItem(board.tables, from, to)
  return tables === board.tables ? board : { ...board, tables }
}

/** Changes a table's columns or rows, kept within limits. */
export function setTableGrid(
  board: Board,
  id: string,
  patch: Partial<Pick<Table, 'columns' | 'rows'>>,
): Board {
  return mapTable(board, id, (table) => ({
    ...table,
    columns: clampInt(patch.columns ?? table.columns, 1, MAX_COLUMNS),
    rows: clampInt(patch.rows ?? table.rows, 1, MAX_ROWS),
  }))
}

// ---------------------------------------------------------------------------------------
// widgets
// ---------------------------------------------------------------------------------------

/** The id the next widget of this kind gets: `cpu-2`, or `gpu-ring-1` for an installed one. */
export function newWidgetId(board: Board, what: NewWidget): string {
  // Leave room for the number: board ids are at most 64 characters.
  return newId(board, typeof what === 'string' ? what : what.widget.slice(0, 56))
}

/**
 * Adds a widget to a table, at its usual width (narrowed to the table): a built-in kind, or a
 * widget installed on the PC. When it does not fit there any more, it starts a new table right
 * after; `tableId` says where it went.
 */
export function addWidget(
  board: Board,
  tableId: string,
  what: NewWidget,
): { board: Board; tableId: string } {
  const index = board.tables.findIndex((table) => table.id === tableId)
  const table = board.tables[index]
  if (!table) return { board, tableId }
  const info = typeof what === 'string' ? WIDGET_KINDS[what] : what
  const id = newWidgetId(board, what)
  const columns = Math.min(info.columns, table.columns)
  const item: BoardWidget =
    typeof what === 'string'
      ? widget(id, what, info.tone, columns)
      : { id, kind: 'installed', widget: what.widget, tone: what.tone, columns, rows: 1 }
  const candidate = { ...table, widgets: [...table.widgets, item] }
  if (table.widgets.length < MAX_TABLE_WIDGETS && placeTable(candidate).overflow.length === 0) {
    return { board: mapTable(board, tableId, () => candidate), tableId }
  }
  if (board.tables.length >= MAX_TABLES) return { board, tableId }
  // A fresh table sized for the widget: as wide as it is, one row.
  const fresh: Table = {
    id: newId(board, 'table'),
    columns: info.columns,
    rows: 1,
    widgets: [{ ...item, columns: info.columns }],
  }
  const tables = [...board.tables]
  tables.splice(index + 1, 0, fresh)
  return { board: { ...board, tables }, tableId: fresh.id }
}

export function removeWidget(board: Board, tableId: string, widgetId: string): Board {
  return mapTable(board, tableId, (table) => ({
    ...table,
    widgets: table.widgets.filter((item) => item.id !== widgetId),
  }))
}

/** Changes a widget's tone or span; spans stay within the table's grid. */
export function updateWidget(
  board: Board,
  tableId: string,
  widgetId: string,
  patch: Partial<Pick<BoardWidget, 'tone' | 'columns' | 'rows'>>,
): Board {
  return mapTable(board, tableId, (table) => ({
    ...table,
    widgets: table.widgets.map((item) =>
      item.id === widgetId
        ? {
            ...item,
            tone: patch.tone ?? item.tone,
            columns: clampInt(patch.columns ?? item.columns, 1, table.columns),
            rows: clampInt(patch.rows ?? item.rows, 1, table.rows),
          }
        : item,
    ),
  }))
}

/** Reorders the widgets of one table, which changes where each is placed. */
export function moveWidget(board: Board, tableId: string, from: number, to: number): Board {
  return mapTable(board, tableId, (table) => {
    const widgets = moveItem(table.widgets, from, to)
    return widgets === table.widgets ? table : { ...table, widgets }
  })
}

/** Moves a widget to the end of another table. */
export function sendWidget(board: Board, fromId: string, widgetId: string, toId: string): Board {
  const item = board.tables.find((t) => t.id === fromId)?.widgets.find((w) => w.id === widgetId)
  const target = board.tables.find((t) => t.id === toId)
  if (!item || !target || fromId === toId || target.widgets.length >= MAX_TABLE_WIDGETS) {
    return board
  }
  return {
    ...board,
    tables: board.tables.map((table) => {
      if (table.id === fromId) {
        return { ...table, widgets: table.widgets.filter((w) => w.id !== widgetId) }
      }
      if (table.id === toId) return { ...table, widgets: [...table.widgets, item] }
      return table
    }),
  }
}

function mapTable(board: Board, id: string, change: (table: Table) => Table): Board {
  let changed = false
  const tables = board.tables.map((table) => {
    if (table.id !== id) return table
    const next = change(table)
    if (next !== table) changed = true
    return next
  })
  return changed ? { ...board, tables } : board
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return items
  next.splice(to, 0, item)
  return next
}
