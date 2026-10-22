import { reservedIds } from '@shiftpane/widget-sdk'
import { describe, expect, it } from 'vitest'
import { Board, MAX_COLUMNS, MAX_CROP, MAX_TABLES, NO_INSETS, WidgetKind } from './board.ts'
import { parsePcMessage, parsePhoneMessage } from './messages.ts'
import { InstalledWidgetData } from './widgets.ts'

const board = (): Board => ({
  gap: 12,
  radius: 28,
  crop: { portrait: NO_INSETS, landscape: NO_INSETS },
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
})

describe('Board', () => {
  it('accepts a board of tables', () => {
    expect(Board.safeParse(board()).success).toBe(true)
  })

  it('needs at least one table and caps how many', () => {
    expect(Board.safeParse({ ...board(), tables: [] }).success).toBe(false)
    const [table] = board().tables
    const many = Array.from({ length: MAX_TABLES + 1 }, (_, i) => ({
      ...table,
      id: `table-${i}`,
      widgets: [],
    }))
    expect(Board.safeParse({ ...board(), tables: many }).success).toBe(false)
  })

  it('rejects unknown widgets, odd ids and grids out of range', () => {
    const with_ = (change: (b: Board) => unknown) => Board.safeParse(change(board())).success
    expect(with_((b) => ({ ...b, gap: -1 }))).toBe(false)
    expect(with_((b) => ({ ...b, tables: [{ ...b.tables[0], columns: MAX_COLUMNS + 1 }] }))).toBe(
      false,
    )
    expect(
      with_((b) => ({
        ...b,
        tables: [
          {
            ...b.tables[0],
            widgets: [{ id: 'x-1', kind: 'browser', tone: 'light', columns: 1, rows: 1 }],
          },
        ],
      })),
    ).toBe(false)
    expect(with_((b) => ({ ...b, tables: [{ ...b.tables[0], id: '../table' }] }))).toBe(false)
  })

  it('rejects an id used twice', () => {
    const b = board()
    const [table] = b.tables
    if (!table) throw new Error('fixture')
    const twice = { ...b, tables: [table, { ...table, id: 'table-2' }] }
    expect(Board.safeParse(twice).success).toBe(false)
  })
})

describe('older boards', () => {
  it('still parse with the background setting the phone no longer has', () => {
    const parsed = Board.safeParse({ ...board(), theme: 'light' })
    expect(parsed.success && 'theme' in parsed.data).toBe(false)
  })

  it('get no crop when they were saved without one', () => {
    const { crop: _, ...old } = board()
    const parsed = Board.safeParse(old)
    expect(parsed.success && parsed.data.crop).toEqual({
      portrait: NO_INSETS,
      landscape: NO_INSETS,
    })
  })
})

describe('crop', () => {
  it('keeps each side within range', () => {
    const cropped = (right: number) =>
      Board.safeParse({
        ...board(),
        crop: { portrait: NO_INSETS, landscape: { ...NO_INSETS, right } },
      }).success
    expect(cropped(60)).toBe(true)
    expect(cropped(-1)).toBe(false)
    expect(cropped(MAX_CROP + 1)).toBe(false)
  })
})

describe('screen', () => {
  const screen = (change: object = {}) =>
    JSON.stringify({
      type: 'screen',
      viewport: { width: 852, height: 393 },
      devicePixelRatio: 3,
      monitorFraction: 0.5,
      safeArea: { top: 0, right: 47, bottom: 21, left: 47 },
      ...change,
    })

  it('carries the viewport, split, safe area and which way up the screen is', () => {
    expect(parsePhoneMessage(screen()).ok).toBe(true)
    expect(parsePhoneMessage(screen({ turn: 'landscape-secondary' })).ok).toBe(true)
    expect(parsePhoneMessage(screen({ turn: 'sideways' })).ok).toBe(false)
  })

  it('says what the monitor area shows, when the phone says', () => {
    expect(parsePhoneMessage(screen()).ok).toBe(true)
    expect(parsePhoneMessage(screen({ source: { kind: 'virtual' } })).ok).toBe(true)
    expect(
      parsePhoneMessage(screen({ source: { kind: 'mirror', displayId: '2528732444' } })).ok,
    ).toBe(true)
    expect(parsePhoneMessage(screen({ source: { kind: 'mirror', displayId: '../x' } })).ok).toBe(
      false,
    )
    expect(parsePhoneMessage(screen({ source: { kind: 'camera' } })).ok).toBe(false)
  })

  it('rejects a split or inset that cannot be', () => {
    expect(parsePhoneMessage(screen({ monitorFraction: 1.5 })).ok).toBe(false)
    expect(
      parsePhoneMessage(screen({ safeArea: { top: -1, right: 0, bottom: 0, left: 0 } })).ok,
    ).toBe(false)
    expect(parsePhoneMessage(screen({ viewport: { width: 0, height: 393 } })).ok).toBe(false)
  })
})

describe('board messages', () => {
  it('carries a board from the phone and a board or null from the PC', () => {
    expect(parsePhoneMessage(JSON.stringify({ type: 'board.save', board: board() })).ok).toBe(true)
    expect(parsePcMessage(JSON.stringify({ type: 'board', board: board() })).ok).toBe(true)
    expect(parsePcMessage(JSON.stringify({ type: 'board', board: null })).ok).toBe(true)
    expect(parsePhoneMessage(JSON.stringify({ type: 'board.save', board: null })).ok).toBe(false)
  })
})

describe('installed widgets on a board', () => {
  const installed = (widget: string) => ({
    ...board(),
    tables: [
      {
        id: 'table-1',
        columns: 2,
        rows: 1,
        widgets: [
          { id: 'gpu-ring-1', kind: 'installed', widget, tone: 'dark', columns: 1, rows: 1 },
        ],
      },
    ],
  })

  it('places one by its manifest id', () => {
    const parsed = Board.safeParse(installed('gpu-ring'))
    expect(parsed.success).toBe(true)
    expect(parsed.data?.tables[0]?.widgets[0]).toMatchObject({
      kind: 'installed',
      widget: 'gpu-ring',
    })
  })

  it('needs an id that could be a manifest id', () => {
    expect(Board.safeParse(installed('../gpu')).success).toBe(false)
    expect(Board.safeParse(installed('GPU')).success).toBe(false)
  })

  it('needs the id for an installed widget, and takes none for a built-in one', () => {
    const b = installed('gpu-ring')
    const [table] = b.tables
    if (!table) throw new Error('fixture')
    const without = {
      ...b,
      tables: [{ ...table, widgets: [{ ...table.widgets[0], widget: undefined }] }],
    }
    expect(Board.safeParse(without).success).toBe(false)
    const builtIn = Board.safeParse({
      ...b,
      tables: [{ ...table, widgets: [{ ...table.widgets[0], kind: 'cpu' }] }],
    })
    expect(builtIn.success && 'widget' in (builtIn.data.tables[0]?.widgets[0] ?? {})).toBe(false)
  })

  it('keeps every built-in kind out of the ids a package can take', () => {
    for (const kind of WidgetKind.options) expect(reservedIds).toContain(kind)
    expect(reservedIds).toContain('installed')
  })
})

describe('widgets.installed', () => {
  const gpuRing = {
    id: 'gpu-ring',
    name: 'GPU ring',
    version: '1.1.0',
    sizes: ['small'],
    actions: [],
    view: { small: { type: 'ring', bind: '@gpu/percent' } },
  }

  it('carries what a phone needs to draw each installed widget', () => {
    const frame = JSON.stringify({ type: 'widgets.installed', widgets: [gpuRing] })
    expect(parsePcMessage(frame).ok).toBe(true)
  })

  it('rejects a view the SDK would not accept', () => {
    const bad = { ...gpuRing, view: { small: { type: 'iframe', src: 'https://example.com' } } }
    expect(parsePcMessage(JSON.stringify({ type: 'widgets.installed', widgets: [bad] })).ok).toBe(
      false,
    )
  })

  it('is only ever sent by the PC', () => {
    expect(parsePhoneMessage(JSON.stringify({ type: 'widgets.installed', widgets: [] })).ok).toBe(
      false,
    )
  })

  it('pairs with installed widget data in widget.update', () => {
    expect(
      InstalledWidgetData.safeParse({
        sources: { gpu: { percent: 40, history: [1, 2] } },
        output: { total: 3 },
        config: { owner: 'kwiruu' },
        problem: null,
      }).success,
    ).toBe(true)
    expect(
      InstalledWidgetData.safeParse({
        sources: {},
        output: null,
        config: {},
        problem: 'x'.repeat(300),
      }).success,
    ).toBe(false)
  })
})

describe('widget.action', () => {
  const action = (change: object) =>
    parsePhoneMessage(
      JSON.stringify({
        type: 'widget.action',
        widget: 'volume-knob',
        action: 'audio.toggle-mute',
        ...change,
      }),
    ).ok

  it('presses one of the fixed actions for an installed widget', () => {
    expect(action({})).toBe(true)
    expect(action({ action: 'audio.set-volume', value: 40 })).toBe(true)
  })

  it('takes no other action, no volume out of range and no odd widget id', () => {
    expect(action({ action: 'shell.run' })).toBe(false)
    expect(action({ action: 'audio.set-volume', value: 140 })).toBe(false)
    expect(action({ widget: '../x' })).toBe(false)
  })
})
