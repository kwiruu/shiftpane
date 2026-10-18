/** ShiftPane's mark: a narrow and a wide pane, drawn straight onto the window. */
export function Logo({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="10 10 80 80" className={className} role="img" aria-label="ShiftPane">
      <rect x="38" y="25" width="44" height="51" rx="15" fill="#fff" />
      <rect x="18" y="25" width="20" height="51" rx="10" fill="#d9d9d9" />
    </svg>
  )
}
