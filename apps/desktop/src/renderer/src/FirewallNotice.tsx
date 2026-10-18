import { Icon } from '@shiftpane/ui/icons'
import { useState } from 'react'
import type { FirewallAllowResult, FirewallState } from '../../shared/firewall.ts'
import { Button } from './shell/parts.tsx'

type Blocked = Extract<FirewallState, { status: 'blocked' }>

/** Shown above the QR code when Windows Firewall would leave a scanning phone stuck loading. */
export function FirewallNotice({ state }: { state: Blocked }) {
  const [pending, setPending] = useState<'allow' | 'check' | null>(null)
  const [outcome, setOutcome] = useState<FirewallAllowResult | null>(null)
  const { title, detail } = describe(state)

  async function allow() {
    setPending('allow')
    setOutcome(null)
    try {
      setOutcome(await window.shiftpane.firewall.allow())
    } finally {
      setPending(null)
    }
  }

  async function check() {
    setPending('check')
    try {
      await window.shiftpane.firewall.check()
    } finally {
      setPending(null)
    }
  }

  return (
    <div
      role="alert"
      className="flex w-full gap-3 rounded-[0.625rem] border border-warn/25 bg-warn/[0.06] p-3.5 text-left text-sm"
    >
      <Icon name="shield" className="size-5 text-warn" />
      <div className="min-w-0">
        <p className="font-medium text-warn">{title}</p>
        <p className="mt-1 text-ink-muted">{detail}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.canAllow && (
            <Button tone="primary" disabled={pending !== null} onClick={allow}>
              {pending === 'allow' ? 'Waiting for Windows…' : 'Allow through firewall'}
            </Button>
          )}
          {state.reason === 'public-network' && (
            <Button onClick={() => void window.shiftpane.firewall.openSettings('network')}>
              Open network settings
            </Button>
          )}
          {state.reason === 'all-inbound-blocked' && (
            <Button onClick={() => void window.shiftpane.firewall.openSettings('firewall')}>
              Open firewall settings
            </Button>
          )}
          <Button icon="refresh" disabled={pending !== null} onClick={check}>
            {pending === 'check' ? 'Checking…' : 'Check again'}
          </Button>
        </div>
        {outcome === 'cancelled' && (
          <p className="mt-2 text-ink-muted text-xs">
            Windows didn’t get permission, so nothing changed.
          </p>
        )}
        {outcome === 'failed' && (
          <p className="mt-2 text-danger text-xs">
            Couldn’t add the firewall rule. You can allow ShiftPane yourself in Windows Security,
            under Firewall &amp; network protection.
          </p>
        )}
      </div>
    </div>
  )
}

function describe({ reason, port, network, canAllow }: Blocked): { title: string; detail: string } {
  const permission = 'Windows asks for permission first.'
  switch (reason) {
    case 'no-rule':
      return {
        title: 'Windows Firewall is blocking phones',
        detail: `Phones can’t reach ShiftPane on port ${port}, so they get stuck loading. Allowing it adds a firewall rule for private networks. ${permission}`,
      }
    case 'block-rule':
      return {
        title: 'A firewall rule is blocking ShiftPane',
        detail: `Windows Firewall has a rule that blocks ShiftPane, usually left by dismissing Windows’ “allow access” prompt. Allowing replaces it with a rule for private networks. ${permission}`,
      }
    case 'public-network':
      return {
        title: network
          ? `“${network.name}” is a public network`
          : 'Windows treats this network as public',
        detail: `Windows Firewall keeps phones away from ShiftPane on public networks. If you trust this network, like your home or office Wi-Fi, set it to Private in network settings${canAllow ? ', then allow ShiftPane through the firewall' : ''}.`,
      }
    case 'all-inbound-blocked':
      return {
        title: 'Windows Firewall blocks all incoming connections',
        detail: `“Block all incoming connections” is on for ${network?.category ?? 'this'} networks, so phones can’t reach port ${port}. Turn it off in Windows Security to pair.`,
      }
    case 'managed':
      return {
        title: 'Your organization manages this firewall',
        detail: `ShiftPane can’t add a firewall rule on this PC. Ask your IT team to allow incoming TCP port ${port} for ShiftPane.`,
      }
  }
}
