import type { BoardWidget, MediaAction } from '@shiftpane/protocol'
import { Component, type ReactNode, useRef } from 'react'
import { AnalogClockWidget } from './AnalogClock.tsx'
import { CalendarWidget } from './Calendar.tsx'
import { ClockWidget } from './Clock.tsx'
import type { PcData } from './data.ts'
import { MediaWidget } from './Media.tsx'
import { CpuWidget, MemoryWidget, NetworkWidget, PcStatsWidget } from './PcStats.tsx'
import { fluid } from './parts.tsx'
import { useElementSize } from './useElementSize.ts'

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

export interface WidgetCardProps {
  widget: Pick<BoardWidget, 'kind' | 'tone'>
  radius: number
  data: PcData
  connected: boolean
  onMediaAction: (action: MediaAction) => void
}

/**
 * One widget on its card. The card is a size container: widgets measure it to pick a layout
 * and size their type in `cqmin`, so the same widget works as a small tile or a whole screen.
 */
export function WidgetCard({ widget, radius, data, connected, onMediaAction }: WidgetCardProps) {
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
    }
  }

  // The padding sits inside the container so its `cqmin` refers to this card, not the page.
  return (
    <div
      className={`tone-${widget.tone} relative size-full overflow-hidden bg-card text-card-ink`}
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
