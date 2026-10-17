import { MAX_PHONES } from '@shiftpane/protocol'
import type { ReactNode } from 'react'
import type { DisplayState } from '../../../shared/display.ts'
import type { FirewallState } from '../../../shared/firewall.ts'
import type { ConnectedPhone, PairingState } from '../../../shared/pairing.ts'
import { DisplayNotice } from '../DisplayNotice.tsx'
import { FirewallNotice } from '../FirewallNotice.tsx'
import { ShellIcon } from '../shell/icons.tsx'
import { splitName } from '../splits.ts'

/** A dark panel with a heading, the building block of every page. */
export function Card({
  title,
  aside,
  children,
  className = '',
}: {
  title?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-panel bg-surface p-5 ${className}`}>
      {(title || aside) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

/** The phone's screen in physical pixels, as it is now (or as it was when it paired). */
function screenPixels(phone: ConnectedPhone): string {
  const viewport = phone.screen?.viewport ?? phone.viewport
  const ratio = phone.screen?.devicePixelRatio ?? phone.devicePixelRatio
  return `${Math.round(viewport.width * ratio)} × ${Math.round(viewport.height * ratio)}`
}

/** One line about the virtual monitor, for a card or a chip. */
export function describeDisplay(display: DisplayState, phones: ConnectedPhone[]): string {
  switch (display.status) {
    case 'unknown':
      return 'Checking the display driver…'
    case 'idle':
      return 'Ready. A monitor appears when a phone asks for one.'
    case 'working':
      return display.size
        ? `Setting up a ${display.size.width} × ${display.size.height} monitor…`
        : 'Getting monitor sizes ready…'
    case 'attached': {
      const phone = phones.find((item) => item.id === display.phoneId)
      return `${display.size.width} × ${display.size.height}, shown on ${phone?.name ?? 'a phone'}.`
    }
    case 'problem':
      return display.message
  }
}

/** The virtual monitor's state, with its notice when it needs the user. */
export function DisplayCard({
  display,
  phones,
}: {
  display: DisplayState
  phones: ConnectedPhone[]
}) {
  const tone =
    display.status === 'attached'
      ? 'bg-ok'
      : display.status === 'problem'
        ? 'bg-warn'
        : display.status === 'working'
          ? 'animate-pulse bg-warn'
          : 'bg-ink-muted'
}

function PairCard({ state, firewall }: { state: PairingState; firewall: FirewallState }) {
  if (state.status !== 'ready') {
    return (
      <Card className="items-center justify-center text-center">
        <p className={`font-semibold text-xl ${state.status === 'error' ? 'text-danger' : ''}`}>
          {state.status === 'error' ? "Can't pair right now" : 'Starting the local server…'}
        </p>
        {state.status === 'error' && (
          <p className="mt-2 max-w-sm text-ink-muted text-sm">{state.message}</p>
        )}
      </Card>
    )
  }

  const origin = `https://${state.host}:${state.port}`
  const steps = [
    'Join the same Wi-Fi as this PC.',
    "Scan the code with the phone's camera.",
    'Accept the certificate warning once; it is expected.',
  ]
  return (
    <Card
      title="Pair a phone"
      aside={
        <button
          type="button"
          onClick={() => void window.shiftpane.pairing.newCode()}
          title="Make a new code and disconnect every phone"
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs transition hover:border-accent"
        >
          <ShellIcon name="refresh" className="size-3.5" />
          New code
        </button>
      }
    >
      {firewall.status === 'blocked' && (
        <div className="mb-4">
          <FirewallNotice key={firewall.reason} state={firewall} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(state.qrSvg)}`}
          alt={`Pairing code for ${origin}`}
          className="size-56 shrink-0 rounded-3xl bg-white p-4"
        />
        <div className="w-full max-w-sm">
          <ol className="flex flex-col gap-3">
            {steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3 text-sm">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-raised font-semibold text-xs tabular-nums">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-ink-muted">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 text-sm">
            {state.hosts.length > 1 ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-ink-muted text-xs">Network</span>
                <select
                  value={state.host}
                  onChange={(event) => void window.shiftpane.pairing.selectHost(event.target.value)}
                  className="rounded-xl border border-border bg-surface-raised px-3 py-2 font-mono text-xs"
                >
                  {state.hosts.map((host) => (
                    <option key={host.address} value={host.address}>
                      {host.address} ({host.interface})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="rounded-xl bg-surface-raised px-3 py-2 text-center font-mono text-ink-muted text-xs">
                {origin}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function PhonesCard({ phones, display }: { phones: ConnectedPhone[]; display: DisplayState }) {
  return (
    <Card
      title="Connected phones"
      aside={
        <span className="rounded-full bg-surface-raised px-2.5 py-1 font-semibold text-xs tabular-nums">
          {phones.length} / {MAX_PHONES}
        </span>
      }
      className="flex-1"
    >
      {phones.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-border border-dashed p-6 text-center">
          <div>
            <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface-raised text-ink-muted">
              <ShellIcon name="qr" />
            </span>
            <p className="font-medium text-sm">No phones yet</p>
            <p className="mt-1 text-ink-muted text-xs">Scan the code to connect one.</p>
          </div>
        </div>
      ) : (
        <ul className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto px-1 [scrollbar-width:thin]">
          {phones.map((phone) => {
            const monitor =
              display.status === 'attached' && display.phoneId === phone.id ? display.size : null
            return (
              <li
                key={phone.id}
                className="flex items-center gap-3 rounded-2xl bg-surface-raised p-3"
              >
                <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink">
                  <ShellIcon name="devices" />
                  <span className="absolute right-0.5 bottom-0.5 size-2.5 rounded-full bg-ok ring-2 ring-surface-raised" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{phone.name}</p>
                  <p className="truncate text-ink-muted text-xs tabular-nums">
                    {screenPixels(phone)}
                    {phone.screen ? ` · ${splitName(phone.screen.monitorFraction)}` : ''} ·{' '}
                    {phone.address.replace(/^::ffff:/, '')}
                  </p>
                  {monitor && (
                    <p className="mt-0.5 text-accent text-xs tabular-nums">
                      Monitor {monitor.width} × {monitor.height}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void window.shiftpane.pairing.disconnect(phone.id)}
                  className="rounded-full px-3 py-1.5 text-danger text-xs transition hover:bg-surface"
                >
                  Disconnect
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Pairing, the phones that are connected, and the virtual monitor they use. */
export function DevicesPage({
  pairing,
  firewall,
  display,
}: {
  pairing: PairingState
  firewall: FirewallState
  display: DisplayState
}) {
  const phones = pairing.status === 'ready' ? pairing.phones : []
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5">
      <PairCard state={pairing} firewall={firewall} />
      <div className="flex min-h-0 flex-col gap-5">
        <PhonesCard phones={phones} display={display} />
        <DisplayCard display={display} phones={phones} />
      </div>
    </div>
  )
}
