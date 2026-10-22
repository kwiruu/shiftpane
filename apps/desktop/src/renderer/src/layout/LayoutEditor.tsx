import {
  addWidget,
  cropFor,
  type DropAt,
  isFlipped,
  moveWidget,
  newId,
  placeTable,
  removeWidget,
  screenLayout,
  sendWidget,
  setCrop,
} from '@shiftpane/board'
import { SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'
import type { MonitorSource, ScreenTurn, WidgetKind } from '@shiftpane/protocol'
import { useEffect, useRef, useState } from 'react'
import type { ConnectedPhone } from '../../../shared/pairing.ts'
import { Button, Card, Select } from '../shell/parts.tsx'
import { monitorLabel, sameSource, sourceOfValue, sourceValue, VIRTUAL } from '../sources.ts'
import { presetOf, SPLIT_LABELS, splitName } from '../splits.ts'
import { useBoard } from '../useBoard.ts'
import { useMonitors } from '../useMonitors.ts'
import { useSampleData } from '../useSampleData.ts'
import { PhonePreview } from './PhonePreview.tsx'
import { type SendTarget, TablesPanel } from './TablesPanel.tsx'
import { WidgetEditor } from './WidgetEditor.tsx'
import { WidgetPicker } from './WidgetPicker.tsx'

/** Screens to preview on: each connected phone, or a generic phone before any has connected. */
interface Device {
  id: string
  label: string
  /** CSS pixels: as a phone has it now, or upright for a preset. */
  width: number
  height: number
  devicePixelRatio: number
  /**
   * The phone's own split, which the preview follows along with its size. Null when it is
   * picked here: for a preset, or a phone that has not reported its screen.
   */
  monitorFraction: number | null
  /** Which way up the phone is, so a crop for its camera follows it when turned round. */
  turn?: ScreenTurn
  /** What its monitor area shows: the virtual monitor until the phone says otherwise. */
  source: MonitorSource
}

/** The screen previewed before any phone has connected. */
const PRESET: Device = {
  id: 'preset-phone',
  label: 'Phone',
  width: 393,
  height: 852,
  devicePixelRatio: 3,
  monitorFraction: null,
  source: VIRTUAL,
}

/** How long a source just picked here is shown before the phone's own report takes over. */
const PICK_SETTLE_MS = 3000

/** Splits to preview, in the phone menu's order of how much is widgets. */
const PICKABLE_SPLITS: SplitPreset[] = ['widgets', '70-30', '50-50', 'monitor']

/** The split picker's value for a phone whose split is none of the presets. */
const PHONE_SPLIT = 'phone'

/** A connected phone, as its last screen report says, or as it was when it paired. */
function deviceOf(phone: ConnectedPhone): Device {
  const { screen } = phone
  if (!screen) {
    return {
      id: phone.id,
      label: phone.name,
      width: phone.viewport.width,
      height: phone.viewport.height,
      devicePixelRatio: phone.devicePixelRatio,
      monitorFraction: null,
      source: VIRTUAL,
    }
  }
  return {
    id: phone.id,
    label: phone.name,
    width: screen.viewport.width,
    height: screen.viewport.height,
    devicePixelRatio: screen.devicePixelRatio,
    monitorFraction: screen.monitorFraction,
    turn: screen.turn,
    source: screen.source ?? VIRTUAL,
  }
}

/**
 * Lays out the phones' widget board: the tables and their settings on the left, the table being
 * edited on the phone's screen in the middle, and the widgets to add on the right. A connected
 * phone is previewed at its real size, rotation and split, live. Every change goes to the phones
 * as it is made.
 */
export function LayoutEditor({ phones }: { phones: ConnectedPhone[] }) {
  const [board, setBoard] = useBoard()
  const data = useSampleData()
  const [picked, setPicked] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  // The stand-in phone starts on its side: that is how a phone is held beside a monitor.
  const [turned, setTurned] = useState(true)
  // The split just picked here: shown at once, until the phone has switched and reports it.
  // With no phone connected it is only a preview. Null follows the phone, or widgets only
  // when there is no phone to follow.
  const [split, setSplit] = useState<SplitPreset | null>(null)
  // The source just picked here, shown until the phone reports it (or does not, within a few
  // seconds: a phone that cannot show a monitor stays on what it had). Null follows the phone.
  const [source, setSource] = useState<MonitorSource | null>(null)
  const monitors = useMonitors()
  // Where a widget dragged out of the picker would land, while it is being dragged.
  const [dropAt, setDropAt] = useState<DropAt | null>(null)
  // The row of the tables list a widget dragged off the preview is over, while it is.
  const [sendTo, setSendTo] = useState<SendTarget | null>(null)
  const pickerGrid = useRef<HTMLDivElement>(null)

  const current = Math.min(picked, board.tables.length - 1)
  const table = board.tables[current]
  const selected = table?.widgets.some((item) => item.id === selectedId) ? selectedId : null

  // Delete removes the picked widget, Escape lets go of it; not while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return
      }
      if (event.key === 'Escape') setSelectedId(null)
      if ((event.key === 'Delete' || event.key === 'Backspace') && table && selected) {
        setBoard(removeWidget(board, table.id, selected))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Connected phones are previewed as they are; the generic phone stands in until one connects.
  const devices = phones.length > 0 ? phones.map(deviceOf) : [PRESET]
  const device = devices.find((item) => item.id === chosen) ?? devices[0] ?? PRESET
  const isPhone = device.id !== PRESET.id

  // Once the phone reports the split that was picked, the preview follows the phone again.
  useEffect(() => {
    if (split !== null && device.monitorFraction === SPLIT_PRESETS[split]) setSplit(null)
  }, [split, device.monitorFraction])

  useEffect(() => {
    if (source === null) return
    if (sameSource(source, device.source)) {
      setSource(null)
      return
    }
    const timer = setTimeout(() => setSource(null), PICK_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [source, device.source])

  if (!table) return null

  // A phone that reports its screen is shown at its size and rotation; anything else is turned
  // here. Either can be previewed at another split than the phone's own.
  const follows = device.monitorFraction !== null
  const width = !follows && turned ? device.height : device.width
  const height = !follows && turned ? device.width : device.height
  const fraction =
    split !== null ? SPLIT_PRESETS[split] : (device.monitorFraction ?? SPLIT_PRESETS.widgets)
  // The crop as this phone is held now; kept turned round if it is the other way up.
  const landscape = width >= height
  const flipped = follows && isFlipped(device.turn)
  const crop = cropFor(board, landscape, flipped)
  // What the split picker shows when nothing was just picked: the phone's own split.
  const splitValue =
    device.monitorFraction === null ? 'widgets' : (presetOf(device.monitorFraction) ?? PHONE_SPLIT)
  // What the source picker shows: the one just picked, or the phone's own. A copy of a monitor
  // that is not listed (yet, or any more) gets an entry of its own, so the picker never lies.
  const shownSource = source ?? device.source
  const unlisted =
    shownSource.kind === 'mirror' &&
    !monitors.some((monitor) => monitor.id === shownSource.displayId)
  // Widgets only: the phone has no monitor area, so there is nothing to show in it.
  const noMonitorArea = fraction === SPLIT_PRESETS.widgets
  // The phone's own layout math: the crop comes off the screen, then the monitor and the
  // widgets split the rest, so everything lands where the phone puts it.
  const laid = screenLayout({ width, height }, device.devicePixelRatio, fraction, crop)
  const area = laid?.area ?? { x: 0, y: 0, width, height }
  const layout = laid?.split
  const sized = (rect: { width: number; height: number }) => rect.width > 0 && rect.height > 0
  // A split hands one side nothing when it is all widgets or all monitor; that side is not drawn.
  const monitor = layout && sized(layout.monitor) ? layout.monitor : null
  const panel = !layout ? area : sized(layout.panel) ? layout.panel : null

  const pick = (index: number) => {
    setPicked(index)
    setSelectedId(null)
  }

  /**
   * The slot in the preview under this point, for a widget dragged out of the picker. It walks
   * the whole stack under the pointer, because the crop frame's handles lie over the table.
   */
  const slotUnder = (x: number, y: number): DropAt | null => {
    for (const under of document.elementsFromPoint(x, y)) {
      const slot = under.closest<HTMLElement>('[data-widget-index],[data-cell]')
      if (slot?.dataset.tableId === table.id) {
        const cell = slot.dataset.cell?.split(',').map(Number)
        if (cell?.length === 2 && cell.every(Number.isInteger)) {
          return { kind: 'cell', column: Number(cell[0]), row: Number(cell[1]) }
        }
        const index = Number(slot.dataset.widgetIndex)
        if (Number.isInteger(index)) return { kind: 'widget', index }
      }
      // Anywhere else on the table the widget goes at the end, as clicking the picker does.
      if (under instanceof HTMLElement && under.dataset.tableRoot === table.id) {
        return { kind: 'end' }
      }
    }
    return null
  }

  /**
   * The table whose row in the list is under this point, for a widget dragged off the preview,
   * and whether the widget would have room there. Null over anything else, and over this
   * table's own row. It walks the whole stack for the same reason `slotUnder` does.
   */
  const rowUnder = (widgetId: string, x: number, y: number): SendTarget | null => {
    for (const under of document.elementsFromPoint(x, y)) {
      const row = under.closest<HTMLElement>('[data-table-index]')
      if (!row) continue
      const index = Number(row.dataset.tableIndex)
      const to = board.tables[index]
      if (!to || to.id === table.id) return null
      // `sendWidget` gives the board back when the move is refused. It keeps a widget that has
      // no room as hidden on the other table, so room is checked here: it would vanish.
      const sent = sendWidget(board, table.id, widgetId, to.id)
      const landed = sent.tables[index]
      const fits =
        sent !== board &&
        !!landed &&
        placeTable(landed).placed.some(({ widget }) => widget.id === widgetId)
      return { index, fits }
    }
    return null
  }

  /**
   * Puts a widget on the table being edited: at `at` when it was dropped on a widget, which
   * pushes that one along, and otherwise at the end.
   */
  const addKind = (kind: WidgetKind, at: DropAt | null) => {
    const id = newId(board, kind)
    const added = addWidget(board, table.id, kind)
    if (added.board === board) return
    const landed = added.board.tables.find((item) => item.id === added.tableId)
    const next =
      at?.kind === 'widget' && added.tableId === table.id && landed
        ? moveWidget(added.board, table.id, landed.widgets.length - 1, at.index)
        : added.board
    setBoard(next)
    setPicked(next.tables.findIndex((item) => item.id === added.tableId))
    setSelectedId(id)
  }

  let summary = 'Phones get this layout when they connect.'
  if (follows && split === null) {
    summary = `As ${device.label} shows it now: ${width} × ${height}, ${splitName(fraction)}.`
  } else if (follows && device.monitorFraction !== null) {
    summary = `Previewing ${splitName(fraction)} · ${device.label} uses ${splitName(device.monitorFraction)}.`
  } else if (phones.length > 0) {
    summary = 'Changes reach your phones as you make them.'
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[19rem_minmax(0,1fr)_19rem] gap-4">
      <TablesPanel
        board={board}
        installed={data.installed}
        current={current}
        aspect={(panel ?? area).width / (panel ?? area).height}
        selectedId={selected}
        sendTo={sendTo}
        onPick={pick}
        onSelect={setSelectedId}
        onChange={setBoard}
      />

      <Card
        title={`Table ${current + 1}`}
        icon="phone"
        aside={
          <>
            {devices.length > 1 && (
              <Select
                aria-label="Preview on"
                icon="phone"
                value={device.id}
                onChange={(event) => {
                  setChosen(event.target.value)
                  setSplit(null)
                  setSource(null)
                }}
                className="max-w-44"
              >
                {devices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            )}
            <Select
              aria-label="Split"
              title={
                isPhone
                  ? `Switches ${device.label} to this split`
                  : 'A preview only: no phone is connected'
              }
              value={split ?? splitValue}
              onChange={(event) => {
                const value = event.target.value
                if (value === PHONE_SPLIT) {
                  setSplit(null)
                  return
                }
                const next = value as SplitPreset
                setSplit(next)
                // The phone switches, keeps it, and reports its screen: the preview then follows.
                if (isPhone) void window.shiftpane.pairing.setSplit(device.id, next)
              }}
              className="shrink-0"
            >
              {splitValue === PHONE_SPLIT && device.monitorFraction !== null && (
                <option value={PHONE_SPLIT}>{splitName(device.monitorFraction)}</option>
              )}
              {PICKABLE_SPLITS.map((key) => (
                <option key={key} value={key}>
                  {SPLIT_LABELS[key]}
                </option>
              ))}
            </Select>
            {/* Only with a phone: there is nothing on this PC for it to switch otherwise. */}
            {isPhone && (
              <Select
                aria-label="Show"
                disabled={noMonitorArea}
                title={
                  noMonitorArea
                    ? `${device.label} is showing only widgets: it has no monitor area`
                    : `Switches what ${device.label} shows in its monitor area`
                }
                value={sourceValue(shownSource)}
                onChange={(event) => {
                  const next = sourceOfValue(event.target.value)
                  if (!next) return
                  setSource(next)
                  // The phone switches, keeps it, and reports its screen: the picker then follows.
                  void window.shiftpane.pairing.setSource(device.id, next)
                }}
                className="max-w-44"
              >
                <option value={sourceValue(VIRTUAL)}>Extra monitor</option>
                {monitors.map((monitor, index) => (
                  <option
                    key={monitor.id}
                    value={sourceValue({ kind: 'mirror', displayId: monitor.id })}
                  >
                    {monitorLabel(monitor, index)}
                  </option>
                ))}
                {unlisted && <option value={sourceValue(shownSource)}>Monitor gone</option>}
              </Select>
            )}
            {/* A phone brings its own orientation, so this is for the preview alone. */}
            {!isPhone && !follows && (
              <Button icon="rotate" onClick={() => setTurned(!turned)} title="Turn the preview">
                <span className="max-wide:hidden">{width > height ? 'Landscape' : 'Portrait'}</span>
              </Button>
            )}
          </>
        }
        bodyClassName="gap-3 p-4"
      >
        <p className="text-ink-muted text-xs">{summary}</p>

        <PhonePreview
          board={board}
          current={current}
          screen={{ width, height }}
          area={area}
          monitor={monitor}
          stream={layout?.stream ?? null}
          panel={panel}
          crop={crop}
          onCrop={(next) => setBoard(setCrop(board, landscape, flipped, next))}
          data={data}
          editing={{
            selectedId: selected,
            dropAt,
            onSelect: setSelectedId,
            onMove: (from, to) => setBoard(moveWidget(board, table.id, from, to)),
            onAddAt: () => pickerGrid.current?.scrollTo({ top: 0, behavior: 'smooth' }),
            onDragTo: (widgetId, x, y) => setSendTo(rowUnder(widgetId, x, y)),
            // Let go over a table's row and the widget goes to the end of that table. The editor
            // stays on this table so more can be moved off it; the row's thumbnail shows it landed.
            onDrop: (widgetId, x, y) => {
              const to = rowUnder(widgetId, x, y)
              setSendTo(null)
              const target = to?.fits ? board.tables[to.index] : undefined
              if (!target) return
              setBoard(sendWidget(board, table.id, widgetId, target.id))
              setSelectedId(null)
            },
            onDragCancel: () => setSendTo(null),
          }}
        />

        <p className="text-center text-ink-faint text-xs">
          {!panel
            ? 'Only the PC’s screen shows in this split. Pick another split to lay out widgets.'
            : 'Drag a widget in from the right · click one to change it · drag it to move it, or onto a table on the left · drag the screen’s edges to keep space clear, and the PC’s screen to move it all'}
        </p>
      </Card>

      <WidgetPicker
        data={data}
        editor={
          <WidgetEditor
            board={board}
            installed={data.installed}
            current={current}
            selectedId={selected}
            onChange={setBoard}
            onSelect={setSelectedId}
          />
        }
        tableNumber={current + 1}
        gridRef={pickerGrid}
        onAdd={(kind) => addKind(kind, null)}
        onDragTo={(x, y) => setDropAt(slotUnder(x, y))}
        onDrop={(kind, x, y) => {
          const at = slotUnder(x, y)
          setDropAt(null)
          if (at) addKind(kind, at)
        }}
        onCancel={() => setDropAt(null)}
      />
    </div>
  )
}
