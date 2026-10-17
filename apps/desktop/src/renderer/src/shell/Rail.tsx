import { Logo, ShellIcon, type ShellIconName } from './icons.tsx'

export type View = 'devices' | 'layout' | 'marketplace' | 'settings'

interface Item {
  id: View
  label: string
  icon: ShellIconName
}

const MAIN: Item[] = [
  { id: 'devices', label: 'Devices', icon: 'devices' },
  { id: 'layout', label: 'Phone layout', icon: 'layout' },
  { id: 'marketplace', label: 'Marketplace', icon: 'marketplace' },
]

const FOOT: Item[] = [{ id: 'settings', label: 'Settings', icon: 'settings' }]

/**
 * The column of round buttons down the window's left edge: one per view, the open one white.
 * Its top is part of the window's drag area, like the title bar.
 */
export function Rail({
  view,
  onView,
  badges,
}: {
  view: View
  onView: (view: View) => void
  /** A count shown on a view's button, such as the connected phones. */
  badges?: Partial<Record<View, number>>
}) {
  const button = (item: Item) => {
    const open = item.id === view
    const badge = badges?.[item.id]
    return (
      <li key={item.id} className="group relative">
        <button
          type="button"
          aria-label={item.label}
          aria-current={open ? 'page' : undefined}
          onClick={() => onView(item.id)}
          className={`relative grid size-9 place-items-center rounded-full transition ${
            open
              ? 'bg-white text-black shadow-[0_6px_20px_rgb(0_0_0/0.45)]'
              : 'bg-surface-raised text-ink-muted hover:bg-border hover:text-ink'
          }`}
        >
          <ShellIcon name={item.icon} className="size-[1.2rem]" />
          {badge !== undefined && badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 font-semibold text-[10px] text-accent-ink tabular-nums ring-2 ring-surface">
              {badge}
            </span>
          )}
        </button>
        <span className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-surface-raised px-2.5 py-1.5 font-medium text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {item.label}
        </span>
      </li>
    )
  }

  return (
    <nav
      aria-label="Views"
      className={`flex w-16 shrink-0 flex-col items-center bg-surface pb-7 ${
        // macOS keeps its traffic lights in the top corner, so the logo sits below them.
        window.shiftpane.platform === 'macos' ? 'pt-11' : 'pt-7'
      }`}
    >
      <div className="mb-6 [-webkit-app-region:drag]">
        <Logo className="size-8 m-1" />
        <div className="w-full border-b border-2 border-border/50 mt-4" />
      </div>
      <ul className="flex flex-col gap-3">{MAIN.map(button)}</ul>
      <ul className="mt-auto flex flex-col gap-3">{FOOT.map(button)}</ul>
    </nav>
  )
}
