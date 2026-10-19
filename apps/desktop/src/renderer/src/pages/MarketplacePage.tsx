import { addWidget, type PcData, WIDGET_KINDS, WidgetCard } from '@shiftpane/board'
import { type Board, type WidgetKind, WidgetKind as WidgetKinds } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { useEffect, useState } from 'react'
import { Button, Card, Chip } from '../shell/parts.tsx'

type Category = 'Time' | 'PC' | 'Media'

const CATEGORY: Record<WidgetKind, Category> = {
  clock: 'Time',
  'analog-clock': 'Time',
  calendar: 'Time',
  'pc-stats': 'PC',
  cpu: 'PC',
  memory: 'PC',
  network: 'PC',
  media: 'Media',
}

const FILTERS: Array<Category | 'All'> = ['All', 'Time', 'PC', 'Media']

/** How long an "Added" confirmation stays on a card. */
const ADDED_MS = 2000

/**
 * Widgets to put on the phone: the built-in ones today, each with a live preview, and a place
 * for community widgets later.
 */
export function MarketplacePage({
  board,
  onChange,
  data,
}: {
  board: Board
  onChange: (board: Board) => void
  data: PcData
}) {
  const [filter, setFilter] = useState<Category | 'All'>('All')
  const [added, setAdded] = useState<{ kind: WidgetKind; table: number } | null>(null)

  useEffect(() => {
    if (!added) return
    const timer = setTimeout(() => setAdded(null), ADDED_MS)
    return () => clearTimeout(timer)
  }, [added])

  const kinds = WidgetKinds.options.filter((kind) => filter === 'All' || CATEGORY[kind] === filter)
  const count = (category: Category | 'All') =>
    WidgetKinds.options.filter((kind) => category === 'All' || CATEGORY[kind] === category).length
  const onBoard = (kind: WidgetKind) =>
    board.tables.reduce(
      (total, table) => total + table.widgets.filter((item) => item.kind === kind).length,
      0,
    )

  /** Adds to the last table, which starts a new table when it is full. */
  const add = (kind: WidgetKind) => {
    const last = board.tables.at(-1)
    if (!last) return
    const result = addWidget(board, last.id, kind)
    if (result.board === board) return
    onChange(result.board)
    setAdded({ kind, table: result.board.tables.findIndex((t) => t.id === result.tableId) + 1 })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Category"
          className="flex gap-1 rounded-xl border border-border bg-surface p-1"
        >
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={filter === item}
              onClick={() => setFilter(item)}
              className={`flex h-8 items-center gap-2 rounded-lg pr-1.5 pl-3 font-medium text-sm transition ${
                filter === item ? 'lifted text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item}
              <span
                className={`grid h-5 min-w-5 place-items-center rounded-md px-1 font-mono text-[11px] tabular-nums ${
                  filter === item ? 'bg-black/35 text-ink-soft' : 'bg-surface-raised'
                }`}
              >
                {count(item)}
              </span>
            </button>
          ))}
        </div>
        <p className="ml-auto text-ink-muted text-sm">
          Adding puts a widget on your last table, or a new one when it is full.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <ul className="grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {kinds.map((kind) => {
            const info = WIDGET_KINDS[kind]
            const wide = info.columns === 2
            const used = onBoard(kind)
            const justAdded = added?.kind === kind
            return (
              <li key={kind} className={wide ? 'sm:col-span-2' : ''}>
                <Card
                  title={info.name}
                  aside={<Chip>Built in</Chip>}
                  className="h-full"
                  bodyClassName="p-2"
                >
                  <div
                    inert
                    className={`board pointer-events-none overflow-hidden rounded-lg bg-board p-2 ${
                      wide ? 'aspect-[2.3/1]' : 'aspect-[1.15/1]'
                    }`}
                  >
                    <WidgetCard
                      widget={{ kind, tone: info.tone }}
                      radius={16}
                      data={data}
                      connected
                      onMediaAction={() => {}}
                    />
                  </div>
                  <div className="flex flex-1 items-end justify-between gap-3 px-2 pt-3 pb-1.5">
                    <div className="min-w-0">
                      <p className="text-ink-soft text-sm">{info.description}</p>
                      <p className="section-label mt-1.5">
                        {CATEGORY[kind]}
                        {used > 0
                          ? ` · on your phone ${used === 1 ? 'once' : `${used} times`}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      tone={justAdded ? 'raised' : 'primary'}
                      icon={justAdded ? 'check' : 'add'}
                      onClick={() => add(kind)}
                      className={justAdded ? 'text-ok' : ''}
                    >
                      {justAdded ? `Table ${added?.table}` : 'Add'}
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
          <li className="sm:col-span-2">
            <div className="hatched grid h-full min-h-48 place-items-center rounded-panel border border-border-strong border-dashed p-6 text-center">
              <div>
                <span className="raised mx-auto mb-3 grid size-12 place-items-center rounded-xl text-ink-muted">
                  <Icon name="widget-add" className="size-6" />
                </span>
                <p className="font-medium">Community widgets</p>
                <p className="mt-1 max-w-sm text-ink-muted text-sm">
                  Widgets made by others, installed from here. Coming soon.
                </p>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  )
}
