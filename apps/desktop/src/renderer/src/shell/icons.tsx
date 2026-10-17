/** Line icons for the desktop window, drawn on a 24-unit grid. */

const PATHS = {
  devices:
    'M8 2.75h8A1.75 1.75 0 0 1 17.75 4.5v15A1.75 1.75 0 0 1 16 21.25H8A1.75 1.75 0 0 1 6.25 19.5v-15A1.75 1.75 0 0 1 8 2.75ZM11 18h2',
  layout:
    'M5 4h4.5A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 4Zm9.5 0H19a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 19 11h-4.5A1.5 1.5 0 0 1 13 9.5v-4A1.5 1.5 0 0 1 14.5 4Zm0 9H19a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 19 20h-4.5a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5Z',
  marketplace:
    'M4.5 9.5h15l-1.2 9.6a1.75 1.75 0 0 1-1.74 1.53H7.44A1.75 1.75 0 0 1 5.7 19.1L4.5 9.5Zm4-.5V7a3.5 3.5 0 0 1 7 0v2',
  settings: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4',
  monitor:
    'M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9.5A1.5 1.5 0 0 1 20 17H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5ZM8.5 20.5h7M12 17v3.5',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2.5v2.5H14V14Zm3.5 3.5H20V20h-2.5v-2.5ZM14 19.5h.01M19.5 14h.01',
  minimize: 'M6 12h12',
  maximize: 'M6.5 6.5h11v11h-11z',
  restore: 'M8.5 8.5h9v9h-9zM6 15.5V6h9.5',
  close: 'M7 7l10 10M17 7 7 17',
  check: 'M5 12.5 9.5 17 19 7.5',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
} as const

export type ShellIconName = keyof typeof PATHS

export function ShellIcon({
  name,
  className = 'size-5',
}: {
  name: ShellIconName
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`fill-none stroke-current ${className}`}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** ShiftPane's mark: a narrow and a wide pane, drawn straight onto the window. */
export function Logo({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="10 10 80 80" className={className} role="img" aria-label="ShiftPane">
      <rect x="38" y="25" width="44" height="51" rx="15" fill="#fff" />
      <rect x="18" y="25" width="20" height="51" rx="10" fill="#d9d9d9" />
    </svg>
  )
}
