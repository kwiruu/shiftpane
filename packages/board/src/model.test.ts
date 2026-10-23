import { Board, MAX_GAP, MAX_RADIUS, MAX_TABLES } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import {
  addTable,
  addWidget,
  cropFor,
  DEFAULT_BOARD,
  isFlipped,
  moveTable,
  moveWidget,
  newId,
  newInstalledWidget,
  newWidgetId,
  parseBoard,
  pcWidgetsOn,
  placeTable,
  removeTable,
  removeWidget,
  sendWidget,
  setCrop,
  setLook,
  setTableGrid,
  updateWidget,
  WIDGET_KINDS,
  widgetName,
} from './model.ts'

const tableIds = (board: Board) => board.tables.map((table) => table.id)
const widgetIds = (board: Board, tableId: string) =>
  board.tables.find((table) => table.id === tableId)?.widgets.map((item) => item.id)

/** One 2x1 table holding a calendar and a clock. */
const pair: Board = {
  ...DEFAULT_BOARD,
  tables: [
    {
      id: 'table-1',
      columns: 2,
      rows: 1,
      widgets: [
        { id: 'calendar-1', kind: 'calendar', tone: 'light', columns: 1, rows: 1 },
        { id: 'clock-1', kind: 'clock', tone: 'dark', columns: 1, rows: 1 },
      ],
    },
  ],
}

describe('DEFAULT_BOARD', () => {
  it('is a valid board', () => {
    expect(Board.safeParse(DEFAULT_BOARD).success).toBe(true)
  })

  it('is four one-row tables whose widgets all fit', () => {
    expect(
      DEFAULT_BOARD.tables.map((table) => ({
        size: `${table.columns}x${table.rows}`,
        widgets: table.widgets.map((item) => item.kind),
      })),
    ).toEqual([
      { size: '2x1', widgets: ['calendar', 'cpu'] },
      { size: '2x1', widgets: ['memory', 'analog-clock'] },
      { size: '2x1', widgets: ['network'] },
      { size: '2x1', widgets: ['pc-stats'] },
    ])
    for (const table of DEFAULT_BOARD.tables) {
      expect(placeTable(table).overflow).toEqual([])
      expect(placeTable(table).free).toEqual([])
    }
  })

  it('starts the calendar with no card: white text on the board, the opposite of its old white card', () => {
    const calendar = DEFAULT_BOARD.tables[0]?.widgets.find((item) => item.kind === 'calendar')
    expect(calendar?.tone).toBe('black')
    expect(WIDGET_KINDS.calendar.tone).toBe('black')
    // A saved board with a card colour from before still loads; an unknown one is refused.
    expect(parseBoard(JSON.parse(JSON.stringify(DEFAULT_BOARD)))).toEqual(DEFAULT_BOARD)
    expect(
      Board.safeParse({
        ...DEFAULT_BOARD,
        tables: [
          {
            ...DEFAULT_BOARD.tables[0],
            widgets: [{ id: 'x', kind: 'clock', tone: 'purple', columns: 1, rows: 1 }],
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('placeTable', () => {
  it('places widgets in order, each in the first spot it fits', () => {
    const { placed, overflow, free } = placeTable({
      columns: 2,
      rows: 2,
      widgets: [
        { id: 'a', kind: 'cpu', tone: 'light', columns: 1, rows: 1 },
        { id: 'b', kind: 'media', tone: 'dark', columns: 2, rows: 1 },
        { id: 'c', kind: 'cpu', tone: 'light', columns: 1, rows: 1 },
      ],
    })
    expect(placed.map(({ widget, column, row }) => [widget.id, column, row])).toEqual([
      ['a', 0, 0],
      ['b', 0, 1],
      ['c', 1, 0],
    ])
    expect(overflow).toEqual([])
    expect(free).toEqual([])
  })

  it('narrows spans to the grid and overflows what has no room', () => {
    const { placed, overflow, free } = placeTable({
      columns: 1,
      rows: 1,
      widgets: [
        { id: 'a', kind: 'media', tone: 'dark', columns: 2, rows: 2 },
        { id: 'b', kind: 'cpu', tone: 'light', columns: 1, rows: 1 },
      ],
    })
    expect(placed).toHaveLength(1)
    expect(placed[0]).toMatchObject({ columns: 1, rows: 1 })
    expect(overflow.map((item) => item.id)).toEqual(['b'])
    expect(free).toEqual([])
  })

  it('lists the cells left free', () => {
    const { free } = placeTable({
      columns: 2,
      rows: 2,
      widgets: [pair.tables[0]?.widgets[0]].filter((w) => w !== undefined),
    })
    expect(free).toEqual([
      { column: 1, row: 0 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ])
  })
})

describe('look', () => {
  it('clamps the gap and radius', () => {
    const board = setLook(DEFAULT_BOARD, { gap: -4, radius: 500 })
    expect(board.gap).toBe(0)
    expect(board.radius).toBe(MAX_RADIUS)
    expect(setLook(board, { gap: MAX_GAP + 1 }).gap).toBe(MAX_GAP)
  })
})

describe('crop', () => {
  const right = { top: 0, right: 60, bottom: 0, left: 0 }

  it('keeps one crop per shape of screen', () => {
    const board = setCrop(DEFAULT_BOARD, true, false, right)
    expect(cropFor(board, true, false)).toEqual(right)
    expect(cropFor(board, false, false)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('turns the crop round for a phone held the other way up, both ways', () => {
    // Set while the camera is on the right of a phone held the other way up...
    const board = setCrop(DEFAULT_BOARD, true, true, right)
    // ...it is on the left when the phone is held the usual way.
    expect(cropFor(board, true, false)).toEqual({ top: 0, right: 0, bottom: 0, left: 60 })
    expect(cropFor(board, true, true)).toEqual(right)
  })

  it('clamps and rounds each side', () => {
    const crop = { top: -5, right: 12.4, bottom: 9999, left: 0 }
    const board = setCrop(DEFAULT_BOARD, false, false, crop)
    expect(cropFor(board, false, false)).toEqual({ top: 0, right: 12, bottom: 320, left: 0 })
  })

  it('reads which way up the phone is', () => {
    expect(isFlipped('landscape-secondary')).toBe(true)
    expect(isFlipped('landscape-primary')).toBe(false)
    expect(isFlipped(undefined)).toBe(false)
  })
})

describe('tables', () => {
  it('adds an empty table after the given one and keeps ids unique', () => {
    const board = addTable(pair, 0)
    expect(tableIds(board)).toEqual(['table-1', 'table-2'])
    expect(board.tables[1]).toEqual({ id: 'table-2', columns: 2, rows: 2, widgets: [] })
    expect(tableIds(addTable(board, 0))).toEqual(['table-1', 'table-3', 'table-2'])
  })

  it('stops at the table limit', () => {
    let board = pair
    for (let i = 0; i < MAX_TABLES + 3; i += 1) board = addTable(board, 0)
    expect(board.tables).toHaveLength(MAX_TABLES)
  })

  it('removes a table, but always leaves one', () => {
    expect(tableIds(removeTable(addTable(pair, 0), 'table-1'))).toEqual(['table-2'])
    const empty = removeTable(pair, 'table-1')
    expect(empty.tables).toEqual([{ id: 'table-1', columns: 2, rows: 2, widgets: [] }])
  })

  it('moves tables and changes their grid within limits', () => {
    const board = addTable(pair, 0)
    expect(tableIds(moveTable(board, 1, 0))).toEqual(['table-2', 'table-1'])
    expect(moveTable(board, 0, 5)).toBe(board)
    expect(setTableGrid(pair, 'table-1', { columns: 9, rows: 0 }).tables[0]).toMatchObject({
      columns: 6,
      rows: 1,
    })
  })
})

describe('widgets', () => {
  it('adds to the table while it fits', () => {
    const roomy = setTableGrid(pair, 'table-1', { rows: 2 })
    const { board, tableId } = addWidget(roomy, 'table-1', 'cpu')
    expect(tableId).toBe('table-1')
    expect(widgetIds(board, 'table-1')).toEqual(['calendar-1', 'clock-1', 'cpu-1'])
  })

  it('starts a new table after a full one, sized for the widget', () => {
    const { board, tableId } = addWidget(pair, 'table-1', 'media')
    expect(tableId).toBe('table-2')
    expect(tableIds(board)).toEqual(['table-1', 'table-2'])
    expect(board.tables[1]).toEqual({
      id: 'table-2',
      columns: 2,
      rows: 1,
      widgets: [{ id: 'media-1', kind: 'media', tone: 'dark', columns: 2, rows: 1 }],
    })
    expect(Board.safeParse(board).success).toBe(true)
  })

  it('allows the same kind more than once', () => {
    const roomy = setTableGrid(pair, 'table-1', { rows: 2 })
    expect(widgetIds(addWidget(roomy, 'table-1', 'clock').board, 'table-1')).toContain('clock-2')
  })

  it('removes, restyles, resizes within the grid and reorders', () => {
    expect(widgetIds(removeWidget(pair, 'table-1', 'clock-1'), 'table-1')).toEqual(['calendar-1'])
    const changed = updateWidget(pair, 'table-1', 'clock-1', { tone: 'light', columns: 5, rows: 3 })
    expect(changed.tables[0]?.widgets[1]).toMatchObject({ tone: 'light', columns: 2, rows: 1 })
    expect(widgetIds(moveWidget(pair, 'table-1', 1, 0), 'table-1')).toEqual([
      'clock-1',
      'calendar-1',
    ])
  })

  it('sends a widget to another table', () => {
    const board = sendWidget(addTable(pair, 0), 'table-1', 'clock-1', 'table-2')
    expect(widgetIds(board, 'table-1')).toEqual(['calendar-1'])
    expect(widgetIds(board, 'table-2')).toEqual(['clock-1'])
    expect(sendWidget(pair, 'table-1', 'clock-1', 'table-1')).toBe(pair)
  })
})

describe('pcWidgetsOn', () => {
  it('lists the PC widgets the board shows, once each', () => {
    // The default shows PC stats but no media player.
    expect(pcWidgetsOn(DEFAULT_BOARD)).toEqual(['pc-stats'])
    expect(pcWidgetsOn(addWidget(DEFAULT_BOARD, 'table-1', 'media').board)).toEqual([
      'media',
      'pc-stats',
    ])
    expect(pcWidgetsOn(pair)).toEqual([])
  })
})

describe('newId and parseBoard', () => {
  it('takes the smallest free number', () => {
    expect(newId(pair, 'clock')).toBe('clock-2')
    expect(newId(pair, 'table')).toBe('table-2')
  })

  it('restores a saved board and falls back to the default otherwise', () => {
    expect(parseBoard(structuredClone(pair))).toEqual(pair)
    expect(parseBoard(undefined)).toEqual(DEFAULT_BOARD)
    // The earlier format: stacks on one grid.
    expect(parseBoard({ grids: {}, gap: 12, radius: 28, theme: 'light', stacks: [] })).toEqual(
      DEFAULT_BOARD,
    )
  })
})

describe('installed widgets', () => {
  const gpuRing = { id: 'gpu-ring', name: 'GPU ring', sizes: ['small', 'medium'] } as const
  const wideOnly = { id: 'wide-thing', name: 'Wide thing', sizes: ['medium'] } as const

  it('start dark, one cell wide unless they have no small layout', () => {
    expect(newInstalledWidget(gpuRing)).toEqual({
      kind: 'installed',
      widget: 'gpu-ring',
      tone: 'dark',
      columns: 1,
    })
    expect(newInstalledWidget(wideOnly).columns).toBe(2)
  })

  it('go on a table by their manifest id, with ids numbered after it', () => {
    const { board, tableId } = addWidget(pair, 'table-1', newInstalledWidget(wideOnly))
    // The pair's table is full, so the wide widget starts a table of its own.
    expect(tableId).not.toBe('table-1')
    const added = board.tables.find((table) => table.id === tableId)?.widgets[0]
    expect(added).toEqual({
      id: 'wide-thing-1',
      kind: 'installed',
      widget: 'wide-thing',
      tone: 'dark',
      columns: 2,
      rows: 1,
    })
    expect(Board.safeParse(board).success).toBe(true)
    expect(newWidgetId(board, newInstalledWidget(wideOnly))).toBe('wide-thing-2')
  })

  it('keep board ids within their length however long the manifest id', () => {
    const long = { id: 'a'.repeat(64), name: 'Long', sizes: ['small'] } as const
    const { board } = addWidget(DEFAULT_BOARD, 'table-1', newInstalledWidget(long))
    expect(Board.safeParse(board).success).toBe(true)
  })

  it('are named as the PC says, or by id until it has', () => {
    const { board } = addWidget(DEFAULT_BOARD, 'table-4', newInstalledWidget(gpuRing))
    const item = board.tables.flatMap((table) => table.widgets).find((w) => w.kind === 'installed')
    if (!item) throw new Error('not added')
    expect(
      widgetName(item, [{ ...gpuRing, sizes: ['small'], version: '1.0.0', actions: [], view: {} }]),
    ).toBe('GPU ring')
    expect(widgetName(item, [])).toBe('gpu-ring')
  })

  it('are subscribed to by their id', () => {
    const { board } = addWidget(DEFAULT_BOARD, 'table-1', newInstalledWidget(gpuRing))
    expect(pcWidgetsOn(board)).toEqual(['gpu-ring', 'pc-stats'])
  })
})
