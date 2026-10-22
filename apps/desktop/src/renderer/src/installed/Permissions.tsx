import { Icon, type IconName } from '@shiftpane/ui/icons'
import type { PermissionKind, PermissionLine } from '@shiftpane/widget-sdk'

const ICONS: Record<PermissionKind, IconName> = {
  source: 'gauge',
  action: 'cursor',
  local: 'devices',
  network: 'network',
  secret: 'shield',
}

/**
 * What a widget may do, one line each, in the words the marketplace uses. The ones that reveal
 * what you do, or reach this PC's own apps, are marked.
 */
export function PermissionList({
  lines,
  empty = 'It needs nothing from your PC.',
}: {
  lines: PermissionLine[]
  empty?: string
}) {
  if (lines.length === 0) return <p className="text-ink-muted text-sm">{empty}</p>
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={`${line.kind}:${line.value}`} className="flex items-center gap-2.5 text-sm">
          <Icon
            name={line.asks ? 'warning' : ICONS[line.kind]}
            className={`size-4 ${line.asks ? 'text-warn' : 'text-ink-muted'}`}
          />
          <span className={line.asks ? 'text-ink' : 'text-ink-soft'}>{line.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** The warning for a widget that could send what it sees off this PC. */
export function SendsOffPc() {
  return (
    <p className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink-soft">
      It can see what you do and reach the internet, so it could send that off this PC. Only install
      it if you trust who made it.
    </p>
  )
}
