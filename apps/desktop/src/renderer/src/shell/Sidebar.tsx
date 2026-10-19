import { Icon, type IconName } from '@shiftpane/ui/icons'
import { useState } from 'react'
import type { ConnectedPhone } from '../../../shared/pairing.ts'
import { Logo } from './Logo.tsx'

export type View = 'devices' | 'layout' | 'marketplace' | 'settings'

interface Item {
  id: View
  label: string
  icon: IconName
}

const MAIN: Item[] = [
  { id: 'devices', label: 'Devices', icon: 'devices' },
  { id: 'layout', label: 'Phone layout', icon: 'layout' },
  { id: 'marketplace', label: 'Marketplace', icon: 'marketplace' },
]

const SETTINGS: Item = { id: 'settings', label: 'Settings', icon: 'settings' }

/**
 * The window's left column: the logo, the views (the open one raised), the connected phones,
 * and settings at the bottom. Below the `wide` breakpoint it folds down to its icons, which
 * name themselves on hover. Its top is part of the window's drag area, like the title bar.
 */
export function Sidebar({
  view,
  onView,
  phones,
}: {
  view: View
  onView: (view: View) => void
  phones: ConnectedPhone[]
}) {
  const [phonesOpen, setPhonesOpen] = useState(true)

  const link = (item: Item, count?: number) => {
    const open = item.id === view
    return (
      <li key={item.id} className="group/link relative">
        <button
          type="button"
          aria-current={open ? 'page' : undefined}
          aria-label={item.label}
          onClick={() => onView(item.id)}
          className={`flex h-10 w-full items-center gap-3 rounded-[0.625rem] px-2.5 font-medium text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ink/40 max-wide:justify-center ${
            open ? 'lifted text-ink' : 'text-ink-soft hover:bg-white/[0.035] hover:text-ink'
          }`}
        >
          <Icon
            name={item.icon}
            className={`size-5 transition-colors ${open ? 'text-ink-soft' : 'text-ink-muted group-hover/link:text-ink-soft'}`}
          />
          <span className="truncate max-wide:hidden">{item.label}</span>
          {count !== undefined && count > 0 && (
            <>
              <span className="ml-auto rounded-md border border-border bg-surface-raised px-1.5 font-mono text-[11px] text-ink-soft tabular-nums leading-5 max-wide:hidden">
                {count}
              </span>
              <span className="absolute top-2 right-2.5 size-2 rounded-full bg-ok ring-2 ring-surface-sunken wide:hidden" />
            </>
          )}
        </button>
        <span className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-medium text-xs opacity-0 shadow-lg transition-opacity group-hover/link:opacity-100 wide:hidden">
          {item.label}
        </span>
      </li>
    )
  }

  return (
    <nav
      aria-label="Views"
      className={`flex w-[4.5rem] shrink-0 flex-col border-border border-r bg-surface-sunken px-3 pb-4 wide:w-60 wide:px-4 ${
        // macOS keeps its traffic lights in the top corner, so the logo sits below them.
        window.shiftpane.platform === 'macos' ? 'pt-11' : 'pt-5'
      }`}
    >
      <div className="mb-7 flex h-9 items-center gap-2.5 px-1.5 [-webkit-app-region:drag] max-wide:justify-center">
        <Logo className="size-7 shrink-0" />
        <span className="font-semibold text-[0.9375rem] tracking-tight max-wide:hidden">
          ShiftPane
        </span>
      </div>

      <p className="section-label mb-2 px-2.5 max-wide:hidden">Main</p>
      <ul className="flex flex-col gap-1">
        {MAIN.map((item) => link(item, item.id === 'devices' ? phones.length : undefined))}
      </ul>

      <div className="mt-7 min-h-0 max-wide:hidden">
        <button
          type="button"
          aria-expanded={phonesOpen}
          onClick={() => setPhonesOpen(!phonesOpen)}
          className="section-label flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left transition hover:text-ink-soft"
        >
          <Icon
            name="chevron-down"
            className={`size-3.5 transition-transform ${phonesOpen ? '' : '-rotate-90'}`}
          />
          Phones
        </button>
        {phonesOpen && (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {phones.length === 0 ? (
              <li className="px-2.5 py-2 text-ink-faint text-xs">None connected yet</li>
            ) : (
              phones.map((phone) => (
                <li key={phone.id}>
                  <button
                    type="button"
                    onClick={() => onView('devices')}
                    title={phone.name}
                    className="flex h-9 w-full items-center gap-3 rounded-[0.625rem] px-2.5 text-ink-soft text-sm transition hover:bg-white/[0.035] hover:text-ink"
                  >
                    <Icon name="phone" className="size-[1.125rem] text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate text-left">{phone.name}</span>
                    <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <ul className="mt-auto flex flex-col gap-1 pt-4">{link(SETTINGS)}</ul>
    </nav>
  )
}
