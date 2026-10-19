import { Icon } from '@shiftpane/ui/icons'
import { useEffect, useState } from 'react'

function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const off = window.shiftpane.window.onMaximizedChange(setMaximized)
    void window.shiftpane.window.isMaximized().then(setMaximized)
    return off
  }, [])
  return maximized
}

/** The window's own minimize, maximize and close buttons. */
function WindowControls() {
  const maximized = useMaximized()
  const button =
    'grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-raised hover:text-ink'
  return (
    <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void window.shiftpane.window.minimize()}
        className={button}
      >
        <Icon name="minus" className="size-[1.125rem]" />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void window.shiftpane.window.toggleMaximize()}
        className={button}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={() => void window.shiftpane.window.close()}
        className={`${button} hover:bg-danger/15 hover:text-danger`}
      >
        <Icon name="close" className="size-[1.125rem]" />
      </button>
    </div>
  )
}

/**
 * The top of the window: where you are, as a breadcrumb, and the window buttons. All of it
 * except the buttons drags the window; a double-click maximizes it.
 */
export function TitleBar({ title }: { title: string }) {
  const ownControls = window.shiftpane.platform !== 'macos'
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-border border-b pr-3 pl-6 [-webkit-app-region:drag]">
      <div className="flex min-w-0 items-center gap-2.5 text-[0.9375rem]">
        <Icon name="home" className="size-[1.125rem] text-ink-muted" />
        <span className="text-ink-soft">ShiftPane</span>
        <span className="text-ink-faint">/</span>
        <h1 className="truncate font-semibold">{title}</h1>
      </div>
      {ownControls && (
        <div className="ml-auto">
          <WindowControls />
        </div>
      )}
    </header>
  )
}
