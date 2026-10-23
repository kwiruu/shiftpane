import {
  addWidget,
  type CardWidget,
  type NewWidget,
  newInstalledWidget,
  type PcData,
  WIDGET_KINDS,
  WidgetCard,
} from '@shiftpane/board'
import { type Board, type WidgetKind, WidgetKind as WidgetKinds } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { MARKETPLACE_URL } from '@shiftpane/widget-sdk'
import { type ReactNode, useEffect, useState } from 'react'
import type { FolderCheck } from '../../../shared/widgets.ts'
import { InstallPrompt } from '../installed/InstallPrompt.tsx'
import { WidgetSettings } from '../installed/WidgetSettings.tsx'
import { Button, Card, Chip } from '../shell/parts.tsx'
import { StudioPage } from '../studio/StudioPage.tsx'
import { useInstalled } from '../useInstalled.ts'
import { useSettings } from '../useSettings.ts'

type Category = 'Time' | 'PC' | 'Media'
type Filter = Category | 'All' | 'Installed'

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

const FILTERS: Filter[] = ['All', 'Time', 'PC', 'Media', 'Installed']

/** The gallery on the ShiftPane website, where widgets made by others are found and installed. */
const GALLERY_URL = `${MARKETPLACE_URL}/widgets`

/** How long an "Added" confirmation stays on a card. */
const ADDED_MS = 2000

/** The board id an added widget is known by, for the "Added" confirmation. */
const keyOf = (what: NewWidget) => (typeof what === 'string' ? what : `installed:${what.widget}`)

/**
 * The widgets this PC has, each with a live preview, to put on the phone: the built-in ones, the
 * ones installed, and (in Developer mode) loading one from a folder. New ones come from the
 * website's gallery, whose "Install in ShiftPane" opens an install link here, or from Widget
 * Studio, which opens in place of the list. Either way the widget's permissions show first.
 */
export function WidgetsPage({
  board,
  onChange,
  data,
  openId,
  onOpened,
}: {
  board: Board
  onChange: (board: Board) => void
  data: PcData
  /** A widget an install link asked for: its install prompt opens over Installed. */
  openId?: string | null
  onOpened?: () => void
}) {
  const installed = useInstalled()
  const [settings] = useSettings()
  const developer = settings.developerMode
  const [filter, setFilter] = useState<Filter>('All')
  const [added, setAdded] = useState<{ key: string; table: number } | null>(null)
  const [check, setCheck] = useState<Exclude<FolderCheck, { status: 'canceled' }> | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // Widget Studio, open on a new widget (null) or one it made; undefined while the list shows.
  const [studio, setStudio] = useState<string | null | undefined>(undefined)
  const [studioIds, setStudioIds] = useState<string[]>([])
  useEffect(() => {
    if (studio === undefined) void window.shiftpane.studio.ids().then(setStudioIds)
  }, [studio])

  // An install link: the installed widgets, and the prompt for that one.
  useEffect(() => {
    if (!openId) return
    setFilter('Installed')
    onOpened?.()
    void window.shiftpane.store.check(openId).then((result) => {
      if (result.status !== 'canceled') setCheck(result)
    })
  }, [openId, onOpened])

  useEffect(() => {
    if (!added) return
    const timer = setTimeout(() => setAdded(null), ADDED_MS)
    return () => clearTimeout(timer)
  }, [added])

  const builtIns = (category: Filter) =>
    category === 'Installed'
      ? []
      : WidgetKinds.options.filter((kind) => category === 'All' || CATEGORY[kind] === category)
  const showsInstalled = filter === 'All' || filter === 'Installed'
  const count = (category: Filter) =>
    builtIns(category).length +
    (category === 'All' || category === 'Installed' ? installed.length : 0)

  const onBoard = (key: string) =>
    board.tables.reduce(
      (total, table) =>
        total +
        table.widgets.filter((item) =>
          item.kind === 'installed' ? `installed:${item.widget}` === key : item.kind === key,
        ).length,
      0,
    )

  /** Adds to the last table, which starts a new table when it is full. */
  const add = (what: NewWidget) => {
    const last = board.tables.at(-1)
    if (!last) return
    const result = addWidget(board, last.id, what)
    if (result.board === board) return
    onChange(result.board)
    setAdded({
      key: keyOf(what),
      table: result.board.tables.findIndex((t) => t.id === result.tableId) + 1,
    })
  }

  /** Checks a marketplace widget for the install prompt: an install link, or an update. */
  const getFromStore = async (id: string) => {
    const result = await window.shiftpane.store.check(id)
    if (result.status !== 'canceled') {
      setEditing(null)
      setCheck(result)
    }
  }

  const loadFolder = async (reload?: string) => {
    const result = reload
      ? await window.shiftpane.widgets.reload(reload)
      : await window.shiftpane.widgets.chooseFolder()
    if (result.status !== 'canceled') {
      setEditing(null)
      setCheck(result)
    }
  }

  const editingWidget = installed.find((item) => item.id === editing) ?? null

  const dialogs = (
    <>
      <InstallPrompt
        check={check}
        onClose={() => setCheck(null)}
        onInstalled={(id) => {
          setCheck(null)
          setFilter('Installed')
          setEditing(id)
        }}
      />
      <WidgetSettings
        widget={editingWidget}
        developer={developer}
        onClose={() => setEditing(null)}
        onReload={(id) => void loadFolder(id)}
        onEdit={
          editing && studioIds.includes(editing)
            ? () => {
                setStudio(editing)
                setEditing(null)
              }
            : undefined
        }
      />
    </>
  )

  if (studio !== undefined) {
    return (
      <>
        <StudioPage
          editId={studio}
          data={data}
          onBack={() => setStudio(undefined)}
          onSaved={(result) => {
            setStudio(undefined)
            setCheck(result)
          }}
        />
        {dialogs}
      </>
    )
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
          {builtIns(filter).map((kind) => {
            const info = WIDGET_KINDS[kind]
            return (
              <WidgetTile
                key={kind}
                title={info.name}
                chip="Built in"
                widget={{ kind, tone: info.tone }}
                wide={info.columns === 2}
                description={info.description}
                meta={CATEGORY[kind]}
                used={onBoard(kind)}
                justAdded={added?.key === kind ? added.table : null}
                data={data}
                onAdd={() => add(kind)}
              />
            )
          })}
          {showsInstalled &&
            installed.map((item) => {
              const fresh = newInstalledWidget(item)
              return (
                <WidgetTile
                  key={`installed:${item.id}`}
                  title={item.name}
                  chip={
                    studioIds.includes(item.id)
                      ? 'Made in Studio'
                      : item.origin.kind === 'folder'
                        ? 'From a folder'
                        : 'Installed'
                  }
                  widget={{ kind: 'installed', widget: item.id, tone: fresh.tone }}
                  wide={fresh.columns === 2}
                  description={item.description}
                  meta={`v${item.version} · ${item.author}`}
                  problem={
                    item.revoked !== null
                      ? `Withdrawn from the marketplace: ${item.revoked}`
                      : item.status.problem
                  }
                  extra={
                    item.update && (
                      <Button
                        icon="refresh"
                        className="mt-2"
                        onClick={() => void getFromStore(item.id)}
                      >
                        Update to {item.update}
                      </Button>
                    )
                  }
                  used={onBoard(keyOf(fresh))}
                  justAdded={added?.key === keyOf(fresh) ? added.table : null}
                  data={data}
                  onAdd={item.revoked === null ? () => add(fresh) : undefined}
                  onSettings={() => setEditing(item.id)}
                />
              )
            })}
          {showsInstalled && developer && (
            <li>
              <Placeholder
                icon="widget-add"
                title="Load a widget folder"
                text="A folder with manifest.json, view.json and sample.json. You'll see what it can do before it's installed."
              >
                <Button tone="primary" icon="add" size="md" onClick={() => void loadFolder()}>
                  Choose a folder
                </Button>
              </Placeholder>
            </li>
          )}
          {showsInstalled && (
            <li>
              <Placeholder
                icon="widget-add"
                title="Make a widget"
                text="Pick PC readings and how to show them, or describe it in a sentence. No code, and the phone's cards preview it as you go."
              >
                <Button tone="primary" icon="widgets" size="md" onClick={() => setStudio(null)}>
                  Open Widget Studio
                </Button>
              </Placeholder>
            </li>
          )}
          {showsInstalled && (
            <li className="sm:col-span-2">
              <Placeholder
                icon="marketplace"
                title={
                  filter === 'Installed' && installed.length === 0
                    ? 'Nothing installed yet'
                    : 'Get more widgets'
                }
                text={`Widgets made by others are in the gallery on the ShiftPane website. "Install in ShiftPane" on a widget's page brings it here, after showing you what it can do.${
                  filter === 'Installed' && !developer
                    ? " To load one you're making, turn on Developer mode in Settings."
                    : ''
                }`}
              >
                <Button
                  tone="primary"
                  icon="external"
                  size="md"
                  onClick={() => window.open(GALLERY_URL, '_blank')}
                >
                  Open the gallery
                </Button>
              </Placeholder>
            </li>
          )}
        </ul>
      </div>
      {dialogs}
    </div>
  )
}

function WidgetTile({
  title,
  chip,
  widget,
  wide,
  description,
  meta,
  problem,
  used,
  justAdded,
  data,
  onAdd,
  onSettings,
  extra,
}: {
  title: string
  chip: string
  widget: CardWidget
  wide: boolean
  description: string
  meta: string
  problem?: string | null
  used: number
  /** The table it just went on, while the confirmation shows. */
  justAdded: number | null
  data: PcData
  /** Without it, there is no Add button (a withdrawn widget). */
  onAdd?: () => void
  onSettings?: () => void
  /** Under the description, such as an update button. */
  extra?: ReactNode
}) {
  return (
    <li className={wide ? 'sm:col-span-2' : ''}>
      <Card
        title={title}
        aside={
          <>
            <Chip>{chip}</Chip>
            {onSettings && (
              <button
                type="button"
                aria-label={`${title} settings`}
                title="Settings"
                onClick={onSettings}
                className="grid size-7 place-items-center rounded-md text-ink-muted transition hover:bg-surface-raised hover:text-ink"
              >
                <Icon name="settings" className="size-4" />
              </button>
            )}
          </>
        }
        className="h-full"
        bodyClassName="p-2"
      >
        <div
          inert
          className={`board pointer-events-none overflow-hidden rounded-lg bg-board p-2 ${
            wide ? 'aspect-[2.3/1]' : 'aspect-[1.15/1]'
          }`}
        >
          <WidgetCard widget={widget} radius={16} data={data} connected onMediaAction={() => {}} />
        </div>
        <div className="flex flex-1 items-end justify-between gap-3 px-2 pt-3 pb-1.5">
          <div className="min-w-0">
            <p className="text-ink-soft text-sm">{description}</p>
            <p className="section-label mt-1.5">
              {meta}
              {used > 0 ? ` · on your phone ${used === 1 ? 'once' : `${used} times`}` : ''}
            </p>
            {problem && <p className="mt-1.5 text-warn text-xs">{problem}</p>}
            {extra}
          </div>
          {onAdd && (
            <Button
              tone={justAdded !== null ? 'raised' : 'primary'}
              icon={justAdded !== null ? 'check' : 'add'}
              onClick={onAdd}
              className={justAdded !== null ? 'text-ok' : ''}
            >
              {justAdded !== null ? `Table ${justAdded}` : 'Add'}
            </Button>
          )}
        </div>
      </Card>
    </li>
  )
}

function Placeholder({
  icon,
  title,
  text,
  children,
}: {
  icon: 'widget-add' | 'marketplace'
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <div className="hatched grid h-full min-h-48 place-items-center rounded-panel border border-border-strong border-dashed p-6 text-center">
      <div>
        <span className="raised mx-auto mb-3 grid size-12 place-items-center rounded-xl text-ink-muted">
          <Icon name={icon} className="size-6" />
        </span>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-ink-muted text-sm">{text}</p>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}
