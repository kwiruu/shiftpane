import { useEffect, useState } from 'react'
import { ShellIcon } from './icons.tsx'

function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const off = window.shiftpane.window.onMaximizedChange(setMaximized)
    void window.shiftpane.window.isMaximized().then(setMaximized)
    return off
  }, [])
  return maximized
}

/** The window's own minimize, maximize and close buttons: just the icons. */
function WindowControls() {
  const maximized = useMaximized()
  const button = 'grid size-8 place-items-center text-ink-muted transition hover:text-ink'
  return (
    <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void window.shiftpane.window.minimize()}
        className={button}
      >
        <ShellIcon name="minimize" className="size-[1.125rem]" />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void window.shiftpane.window.toggleMaximize()}
        className={button}
      >
        <ShellIcon name={maximized ? 'restore' : 'maximize'} className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={() => void window.shiftpane.window.close()}
        className={`${button} hover:text-danger`}
      >
        <ShellIcon name="close" className="size-[1.125rem]" />
      </button>
    </div>
  )
}

/**
 * The top of the window: the page's title and the window buttons. All of it except the buttons
 * drags the window; a double-click maximizes it.
 */
export function TitleBar({ title }: { title: string }) {
  const ownControls = window.shiftpane.platform !== 'macos'
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 [-webkit-app-region:drag]">
      <h1 className="font-semibold text-[1.75rem] tracking-tight pl-1 pt-3">{title}</h1>
      {ownControls && (
        <div className="ml-auto">
          <WindowControls />
        </div>
      )}
    </header>
  )
}
