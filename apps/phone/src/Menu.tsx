import { SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'
import type { MonitorInfo, MonitorSource } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { useEffect, useState, useSyncExternalStore } from 'react'

const TONE_DOT = { ok: 'bg-ok', wait: 'bg-warn animate-pulse', bad: 'bg-danger' } as const

const PRESET_LABELS: Record<SplitPreset, string> = {
  monitor: 'Monitor',
  '70-30': '70 / 30',
  '50-50': '50 / 50',
  widgets: 'Widgets',
}

/**
 * The ⋯ button fades out this long after the last touch, so it does not sit over the widgets;
 * any touch brings it back, and the corner stays tappable while it is hidden. It stays in view
 * while the connection needs attention.
 */
const IDLE_MS = 3000

interface MenuProps {
  status: { title: string; detail: string; tone: 'ok' | 'wait' | 'bad' }
  preset: SplitPreset
  onPreset: (preset: SplitPreset) => void
  source: MonitorSource
  onSource: (source: MonitorSource) => void
  monitors: MonitorInfo[]
  /** The PC can add a virtual monitor (driver ready). */
  virtualAvailable: boolean
  connected: boolean
}

const sameSource = (a: MonitorSource, b: MonitorSource) =>
  a.kind === b.kind &&
  (a.kind === 'virtual' || (b.kind === 'mirror' && a.displayId === b.displayId))

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange)
  return () => document.removeEventListener('fullscreenchange', onChange)
}
const isFullscreen = () => document.fullscreenElement !== null

/** Installed to the home screen: already full screen, nothing to offer. */
const installed = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** iPhone Safari has no full-screen API for pages; the home screen app is the way. */
const iosBrowser = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** A tiny picture of a split: the monitor part light, the widget part dim. */
function SplitPicture({ fraction }: { fraction: number }) {
  return (
    <span className="flex h-6 w-10 gap-[2px] overflow-hidden rounded-[6px]" aria-hidden>
      {fraction > 0 && (
        <span className="h-full rounded-[3px] bg-ink-soft" style={{ flex: fraction }} />
      )}
      {fraction < 1 && (
        <span className="h-full rounded-[3px] bg-ink-faint" style={{ flex: 1 - fraction }} />
      )}
    </span>
  )
}

/**
 * The ⋯ button in the top corner and the menu it opens: connection, split, what the monitor
 * area shows and full screen. Widgets are laid out on the PC. The button's dot shows the connection at a
 * glance, so nothing else needs to stay on screen.
 */
export function Menu(props: MenuProps) {
  const { status, preset, onPreset, source, onSource, monitors, virtualAvailable, connected } =
    props
  const [open, setOpen] = useState(false)
  const [idle, setIdle] = useState(false)
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Fade the button while nobody touches the screen.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), IDLE_MS)
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_MS)
    }
    window.addEventListener('pointerdown', wake)
    window.addEventListener('pointermove', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('pointermove', wake)
    }
  }, [])

  const choose = (action: () => void) => {
    action()
    setOpen(false)
  }

  const toggleFullscreen = () => {
    if (fullscreen) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }

  const option = (selected: boolean) =>
    `flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left text-[15px] transition disabled:opacity-40 ${
      selected ? 'lifted text-ink' : 'border border-border bg-surface-sunken/60 text-ink-soft'
    }`

  const heading = 'section-label mb-2 px-0.5'
  const note =
    'rounded-xl border border-border bg-surface-sunken/60 px-3.5 py-3 text-ink-muted text-sm'

  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`fixed top-[max(0.625rem,env(safe-area-inset-top))] right-[max(0.625rem,env(safe-area-inset-right))] z-30 grid size-10 place-items-center rounded-full text-ink-soft raised transition-opacity duration-500 ${
          idle && !open && status.tone === 'ok' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <Icon name="more" className="size-5" />
        <span
          className={`absolute top-0.5 right-0.5 size-2.5 rounded-full ring-2 ring-surface-raised ${TONE_DOT[status.tone]}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-20">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-label="ShiftPane menu"
            className="sheet-in no-scrollbar absolute top-[max(3.75rem,calc(env(safe-area-inset-top)+3.25rem))] right-[max(0.625rem,env(safe-area-inset-right))] max-h-[calc(100dvh-5rem)] w-[min(21rem,calc(100vw-1.25rem))] hatched overflow-y-auto rounded-[24px] border border-border bg-surface-sunken p-1.5 font-sans text-ink shadow-[0_24px_80px_rgb(0_0_0/0.6)]"
          >
            <header className="px-3 pt-2.5 pb-3">
              <p className="flex items-center gap-2 font-medium">
                <span className={`size-2 rounded-full ${TONE_DOT[status.tone]}`} aria-hidden />
                {status.title}
              </p>
              <p className="mt-0.5 text-ink-muted text-sm" role="status">
                {status.detail}
              </p>
            </header>

            <div className="rounded-[18px] border border-border bg-surface p-3.5">
              <h2 className={heading}>Split</h2>
              <div className="mb-4 grid grid-cols-4 gap-1.5">
                {(Object.keys(SPLIT_PRESETS) as SplitPreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={preset === key}
                    onClick={() => choose(() => onPreset(key))}
                    className={`flex flex-col items-center gap-1.5 rounded-xl py-2.5 font-medium text-xs transition ${
                      preset === key
                        ? 'lifted text-ink'
                        : 'border border-border bg-surface-sunken/60 text-ink-muted'
                    }`}
                  >
                    <SplitPicture fraction={SPLIT_PRESETS[key]} />
                    {PRESET_LABELS[key]}
                  </button>
                ))}
              </div>

              <h2 className={heading}>Show</h2>
              <div className="mb-4 flex flex-col gap-1.5">
                <button
                  type="button"
                  aria-pressed={source.kind === 'virtual'}
                  disabled={!virtualAvailable}
                  onClick={() => choose(() => onSource({ kind: 'virtual' }))}
                  className={option(source.kind === 'virtual')}
                >
                  <span>
                    Extra monitor
                    <span className="block text-xs opacity-70">
                      {virtualAvailable
                        ? 'Extend the desktop'
                        : 'Needs the display driver on the PC'}
                    </span>
                  </span>
                  {source.kind === 'virtual' && <Icon name="check" className="size-5 text-ok" />}
                </button>
                {monitors.map((monitor, index) => {
                  const candidate: MonitorSource = { kind: 'mirror', displayId: monitor.id }
                  const selected = sameSource(source, candidate)
                  return (
                    <button
                      key={monitor.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={!connected}
                      onClick={() => choose(() => onSource(candidate))}
                      className={option(selected)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">
                          Duplicate {monitor.name || `display ${index + 1}`}
                        </span>
                        <span className="block text-xs opacity-70">
                          {monitor.width}×{monitor.height}
                          {monitor.primary ? ' · main display' : ''}
                        </span>
                      </span>
                      {selected && <Icon name="check" className="size-5 text-ok" />}
                    </button>
                  )
                })}
                {connected && monitors.length === 0 && (
                  <p className="px-1 text-ink-muted text-xs">Looking for the PC's monitors…</p>
                )}
              </div>

              <h2 className={heading}>Widgets</h2>
              <p className={`mb-4 ${note}`}>
                Lay out the tables in the ShiftPane app on your PC, under{' '}
                <span className="text-ink">Phone layout</span>.
              </p>

              <div className="flex flex-col gap-1.5">
                {!installed() &&
                  (document.fullscreenEnabled ? (
                    <button
                      type="button"
                      onClick={() => choose(toggleFullscreen)}
                      className={option(false)}
                    >
                      {fullscreen ? 'Leave full screen' : 'Full screen'}
                      <Icon
                        name={fullscreen ? 'shrink' : 'expand'}
                        className="size-5 text-ink-muted"
                      />
                    </button>
                  ) : (
                    iosBrowser() && (
                      <p className={note}>
                        For full screen, tap Share, then{' '}
                        <span className="text-ink">Add to Home Screen</span>, and open ShiftPane
                        from there.
                      </p>
                    )
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
