import {
  cropFor,
  isFlipped,
  moveWidget,
  removeWidget,
  screenLayout,
  setCrop,
} from '@shiftpane/board'
import { SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'
import type { ScreenTurn } from '@shiftpane/protocol'
import { useEffect, useRef, useState } from 'react'
import type { ConnectedPhone } from '../../../shared/pairing.ts'
import { SPLIT_LABELS, splitName } from '../splits.ts'
import { useBoard } from '../useBoard.ts'
import { useSampleData } from '../useSampleData.ts'
import { Inspector } from './Inspector.tsx'
import { PhonePreview } from './PhonePreview.tsx'
import { TablesPanel } from './TablesPanel.tsx'

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
}

/** The screen previewed before any phone has connected. */
const PRESET: Device = {
  id: 'preset-phone',
  label: 'Phone',
  width: 393,
  height: 852,
  devicePixelRatio: 3,
  monitorFraction: null,
}

/** Splits to preview, in the phone menu's order of how much is widgets. */
const PICKABLE_SPLITS: SplitPreset[] = ['widgets', '70-30', '50-50', 'monitor']

/** The split picker's value for "as the phone has it". */
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
  }
}

/**
 * Lays out the phones' widget board: the tables on the left, the table being edited on the
 * phone's screen in the middle, and its settings on the right. A connected phone is previewed
 * at its real size, rotation and split, live. Every change goes to the phones as it is made.
 */
export function LayoutEditor({ phones }: { phones: ConnectedPhone[] }) {
  const [board, setBoard] = useBoard()
  const data = useSampleData()
  const [picked, setPicked] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  // The stand-in phone starts on its side: that is how a phone is held beside a monitor.
  const [turned, setTurned] = useState(true)
  // Null previews the phone's own split, or widgets only when there is no phone to follow.
  const [split, setSplit] = useState<SplitPreset | null>(null)
  const addSection = useRef<HTMLDivElement>(null)

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

  let summary = 'Phones get this layout when they connect.'
  if (follows && split === null) {
    summary = `As ${device.label} shows it now: ${width} × ${height}, ${splitName(fraction)}.`
  } else if (follows && device.monitorFraction !== null) {
    summary = `Previewing ${splitName(fraction)} · ${device.label} uses ${splitName(device.monitorFraction)}.`
  } else if (phones.length > 0) {
    summary = 'Changes reach your phones as you make them.'
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[15.5rem_minmax(0,1fr)_19rem] gap-4">
      <TablesPanel
        board={board}
        current={current}
        aspect={(panel ?? area).width / (panel ?? area).height}
        onPick={pick}
        onChange={setBoard}
      />

      <section className="flex min-h-0 flex-col gap-3 rounded-panel bg-surface p-4">
        <header className="flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0">
            <h2 className="font-semibold">Table {current + 1}</h2>
            <p className="text-ink-muted text-xs">{summary}</p>
          </div>
          {devices.length > 1 && (
            <select
              aria-label="Preview on"
              value={device.id}
              onChange={(event) => setChosen(event.target.value)}
              className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm"
            >
              {devices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Split"
            value={split ?? (follows ? PHONE_SPLIT : 'widgets')}
            onChange={(event) => {
              const value = event.target.value
              setSplit(value === PHONE_SPLIT ? null : (value as SplitPreset))
            }}
            className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm"
          >
            {follows && device.monitorFraction !== null && (
              <option value={PHONE_SPLIT}>
                Phone's split · {splitName(device.monitorFraction)}
              </option>
            )}
            {PICKABLE_SPLITS.map((key) => (
              <option key={key} value={key}>
                {SPLIT_LABELS[key]}
              </option>
            ))}
          </select>
          {!follows && (
            <button
              type="button"
              onClick={() => setTurned(!turned)}
              title="Turn the preview"
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent"
            >
              {width > height ? 'Landscape' : 'Portrait'}
            </button>
          )}
        </header>

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
            onSelect: setSelectedId,
            onMove: (from, to) => setBoard(moveWidget(board, table.id, from, to)),
            onAddAt: () => addSection.current?.scrollIntoView({ behavior: 'smooth' }),
          }}
        />

        <p className="text-center text-ink-muted text-xs">
          {!panel
            ? 'Only the PC’s screen shows in this split. Pick another split to lay out widgets.'
            : 'Click a widget to change it · drag it to move it · drag the screen’s edges to keep space clear, and the PC’s screen to move it all'}
        </p>
      </section>

      <Inspector
        board={board}
        current={current}
        selectedId={selected}
        data={data}
        addSection={addSection}
        onChange={setBoard}
        onSelect={setSelectedId}
        onPick={setPicked}
      />
    </div>
  )
}
