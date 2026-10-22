import type { MediaAction, MediaData } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { Cover, Equalizer, fluid, Glow, Waiting } from './parts.tsx'
import type { ElementSize } from './useElementSize.ts'

interface MediaWidgetProps {
  media: MediaData | null
  box: ElementSize
  /** False while the phone cannot reach the PC: the buttons do nothing then. */
  connected: boolean
  onAction: (action: MediaAction) => void
}

/** What the PC is playing, with previous, play/pause and next. */
export function MediaWidget({ media, box, connected, onAction }: MediaWidgetProps) {
  if (!media) return <Waiting />
  const playing = media.status === 'playing'
  const idle = media.status === 'none'
  const title = idle ? 'Nothing playing' : (media.title ?? 'Unknown title')
  const artist = idle ? 'Play something on the PC' : (media.artist ?? media.app ?? '')
  const compact = box.height < 130

  const control = (action: MediaAction, label: string, enabled: boolean, primary = false) => (
    <button
      type="button"
      aria-label={label}
      disabled={!connected || !enabled}
      onClick={() => onAction(action)}
      className={`grid shrink-0 place-items-center rounded-full transition active:scale-90 disabled:opacity-30 ${
        primary ? 'bg-card-ink text-card' : 'text-card-ink'
      }`}
      style={{
        width: primary ? fluid(40, 24, 64) : fluid(34, 18, 52),
        height: primary ? fluid(40, 24, 64) : fluid(34, 18, 52),
      }}
    >
      <Icon
        name={action === 'play-pause' ? (playing ? 'pause' : 'play') : action}
        className={primary ? 'size-[46%]' : 'size-[62%]'}
      />
    </button>
  )

  const playPause = control('play-pause', playing ? 'Pause' : 'Play', media.canPlayPause, true)

  if (compact) {
    return (
      <div className="flex h-full items-center" style={{ gap: fluid(10, 6, 16) }}>
        <Cover title={title} size={fluid(36, 40, 72)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" style={{ fontSize: fluid(13, 10, 18) }}>
            {title}
          </p>
          <p className="truncate text-card-muted" style={{ fontSize: fluid(11, 8, 15) }}>
            {artist}
          </p>
        </div>
        {box.width >= 220 && control('previous', 'Previous track', media.canPrevious)}
        {playPause}
        {box.width >= 220 && control('next', 'Next track', media.canNext)}
      </div>
    )
  }

  const wide = box.width >= box.height * 1.3
  return (
    <div className="relative flex h-full flex-col justify-between">
      <Glow
        style={{ right: '-20%', top: '-45%' }}
        color={playing ? 'var(--color-flame)' : 'var(--card-muted)'}
      />
      <div
        className={`relative flex ${wide ? 'items-center' : 'flex-col items-start'}`}
        style={{ gap: fluid(10, 5, 18) }}
      >
        <Cover title={title} size={wide ? fluid(44, 24, 96) : fluid(44, 30, 120)} />
        <div className="min-w-0 flex-1 self-stretch">
          <div
            className={`flex items-start justify-between gap-2 ${wide ? 'h-full flex-col justify-center' : ''}`}
          >
            <div className="min-w-0 max-w-full">
              <p
                className="truncate font-semibold leading-tight"
                style={{ fontSize: fluid(14, 8.5, 24) }}
              >
                {title}
              </p>
              <p className="truncate text-card-muted" style={{ fontSize: fluid(12, 6.5, 17) }}>
                {artist}
              </p>
            </div>
          </div>
        </div>
      </div>
      {!idle && box.height >= 170 && (
        <p
          className="relative flex items-center gap-2 text-card-muted"
          style={{ fontSize: fluid(11, 5.5, 14) }}
        >
          {playing ? <Equalizer /> : <span className="size-1.5 rounded-full bg-card-muted" />}
          {playing ? 'Playing' : 'Paused'}
          {media.app ? ` on ${media.app}` : ''}
        </p>
      )}
      <div
        className="relative flex items-center justify-between"
        style={{ paddingInline: wide ? fluid(4, 8, 48) : 0 }}
      >
        {control('previous', 'Previous track', media.canPrevious)}
        {playPause}
        {control('next', 'Next track', media.canNext)}
      </div>
    </div>
  )
}
