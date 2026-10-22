import type { MediaAction, Tone, WidgetAction, WidgetKind } from '@shiftpane/protocol'
import { Component, type ReactNode, useRef } from 'react'
import { AnalogClockWidget } from './AnalogClock.tsx'
import { CalendarWidget } from './Calendar.tsx'
import { ClockWidget } from './Clock.tsx'
import type { PcData } from './data.ts'
import { MediaWidget } from './Media.tsx'
import { CpuWidget, MemoryWidget, NetworkWidget, PcStatsWidget } from './PcStats.tsx'
import { fluid, Waiting } from './parts.tsx'
import { type ElementSize, useElementSize } from './useElementSize.ts'
import { sizeForBox, ViewWidget } from './ViewWidget.tsx'

/** Keeps one broken widget from taking the whole board down with it. */
class WidgetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('[widget]', error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <p className="grid h-full place-items-center text-center text-card-muted text-sm">
        This widget stopped working.
      </p>
    )
  }
}

/** What a card shows: a built-in widget by its kind, or an installed one by its id. */
export type CardWidget =
  | { kind: WidgetKind; tone: Tone }
  | { kind: 'installed'; widget: string; tone: Tone }

export interface WidgetCardProps {
  widget: CardWidget
  radius: number
  data: PcData
  connected: boolean
  onMediaAction: (action: MediaAction) => void
  /** A button on an installed widget. Without it, those buttons do nothing (a preview). */
  onWidgetAction?: (action: WidgetAction) => void
}

/**
 * One widget on its card. The card is a size container: widgets measure it to pick a layout
 * and size their type in `cqmin`, so the same widget works as a small tile or a whole screen.
 */
export function WidgetCard({
  widget,
  radius,
  data,
  connected,
  onMediaAction,
  onWidgetAction,
}: WidgetCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const box = useElementSize(ref)
  const stats = { stats: data.pcStats?.data ?? null, recent: data.history, box }

  const content = () => {
    switch (widget.kind) {
      case 'analog-clock':
        return <AnalogClockWidget box={box} />
      case 'clock':
        return <ClockWidget box={box} />
      case 'calendar':
        return <CalendarWidget box={box} />
      case 'media':
        return (
          <MediaWidget
            box={box}
            media={data.media?.data ?? null}
            connected={connected}
            onAction={onMediaAction}
          />
        )
      case 'pc-stats':
        return <PcStatsWidget {...stats} />
      case 'cpu':
        return <CpuWidget {...stats} />
      case 'memory':
        return <MemoryWidget {...stats} />
      case 'network':
        return <NetworkWidget {...stats} />
      case 'installed':
        return (
          <InstalledCard
            id={widget.widget}
            box={box}
            data={data}
            connected={connected}
            onAction={onWidgetAction}
          />
        )
    }
  }

  // The padding sits inside the container so its `cqmin` refers to this card, not the page.
  return (
    <div
      className={`tone-${widget.tone} relative size-full overflow-hidden bg-card text-card-ink shadow-[inset_0_0_0_1px_var(--card-edge)]`}
      style={{ borderRadius: radius, containerType: 'size' }}
    >
      <div
        ref={ref}
        className="size-full"
        style={{ padding: widget.kind === 'analog-clock' ? fluid(8, 5, 16) : fluid(12, 7.5, 24) }}
      >
        {box.width > 0 && box.height > 0 && <WidgetBoundary>{content()}</WidgetBoundary>}
      </div>
    </div>
  )
}

/** A widget installed on the PC, drawn from its view with its latest data. */
function InstalledCard({
  id,
  box,
  data,
  connected,
  onAction,
}: {
  id: string
  box: ElementSize
  data: PcData
  connected: boolean
  onAction?: (action: WidgetAction) => void
}) {
  const installed = data.installed.find((item) => item.id === id)
  if (!installed) return <Waiting label={connected ? 'Not installed on this PC' : undefined} />
  const latest = data.widgets[id]?.data
  if (!latest) return <Waiting />
  if (latest.output === null) {
    return latest.problem ? <Problem text={latest.problem} /> : <Waiting />
  }
  const output = latest.output
  return (
    <ViewWidget
      view={installed.view}
      size={sizeForBox(box)}
      context={{
        sample:
          output !== null && typeof output === 'object' && !Array.isArray(output) ? output : {},
        sources: latest.sources,
        config: latest.config,
      }}
      actions={installed.actions}
      connected={connected}
      onAction={onAction && ((action) => onAction({ widget: id, action }))}
    />
  )
}

/** An installed widget whose collector has nothing to show, and why. */
function Problem({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <p className="text-card-muted" style={{ fontSize: fluid(11, 6, 14) }}>
        {text}
      </p>
    </div>
  )
}
