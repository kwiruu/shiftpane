/** The few icons the phone UI uses, drawn on a 24-unit grid. */

const FILLED = {
  play: 'M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6Z',
  pause:
    'M6.5 5.5A1.5 1.5 0 0 1 8 4h1.5A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20H8a1.5 1.5 0 0 1-1.5-1.5Zm6.5 0A1.5 1.5 0 0 1 14.5 4H16a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 16 20h-1.5a1.5 1.5 0 0 1-1.5-1.5Z',
  next: 'M4.5 6.2v11.6a1 1 0 0 0 1.55.83L14 13.2v4.3a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-11a1 1 0 0 0-1-1H15a1 1 0 0 0-1 1v4.3L6.05 5.37A1 1 0 0 0 4.5 6.2Z',
  previous:
    'M19.5 6.2v11.6a1 1 0 0 1-1.55.83L10 13.2v4.3a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v4.3l7.95-5.43a1 1 0 0 1 1.55.83Z',
  bolt: 'M13.4 2.3 4.6 13.1a.6.6 0 0 0 .47.98H11l-1.2 7.3c-.1.6.66.93 1.04.45l8.56-10.6a.6.6 0 0 0-.47-.98H13l1.4-7.4c.1-.62-.68-.95-1.06-.47Z',
  more: 'M5 10.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Zm7 0a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Zm7 0a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z',
} as const

const STROKED = {
  down: 'M12 4.5v15m-6-6 6 6 6-6',
  up: 'M12 19.5v-15m-6 6 6-6 6 6',
  music: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6.5 6.5l11 11m0-11-11 11',
  check: 'M5 12.5 9.5 17 19 7.5',
  layout:
    'M4 5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Zm9 0a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1Zm0 9a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1Z',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  expand: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5',
  shrink: 'M9 4v5H4m16 0h-5V4m0 16v-5h5M4 15h5v5',
} as const

export type IconName = keyof typeof FILLED | keyof typeof STROKED

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  if (name in FILLED) {
    return (
      <svg viewBox="0 0 24 24" className={`fill-current ${className}`} aria-hidden>
        <path d={FILLED[name as keyof typeof FILLED]} />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className={`fill-none stroke-current ${className}`}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={STROKED[name as keyof typeof STROKED]} />
    </svg>
  )
}
