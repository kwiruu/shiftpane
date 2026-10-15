import type { FirewallState } from '../../shared/firewall.ts'
import type { ConnectedPhone, PairingState } from '../../shared/pairing.ts'
import { FirewallNotice } from './FirewallNotice.tsx'
import { useFirewall } from './useFirewall.ts'
import { usePairing } from './usePairing.ts'

const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const

export function App() {
  const pairing = usePairing()
  const firewall = useFirewall()
  const { platform, versions } = window.shiftpane

  return (
    <main className="grid h-full grid-cols-[minmax(0,1fr)_20rem] gap-5 bg-surface-sunken p-5 text-ink">
      <PairPanel state={pairing} firewall={firewall} />
      <aside className="flex min-h-0 flex-col gap-4 rounded-panel bg-surface p-5">
        <header>
          <h1 className="font-semibold text-lg">ShiftPane</h1>
          <p className="text-ink-muted text-xs">
            {PLATFORM_LABEL[platform]} · v{versions.app}
          </p>
        </header>
        <PhoneList phones={pairing.status === 'ready' ? pairing.phones : []} />
      </aside>
    </main>
  )
}

function PairPanel({ state, firewall }: { state: PairingState; firewall: FirewallState }) {
  if (state.status === 'starting') {
    return <Panel title="Starting local server…" />
  }
  if (state.status === 'error') {
    return <Panel title="Can't pair right now" detail={state.message} tone="danger" />
  }

  const origin = `https://${state.host}:${state.port}`
  const blocked = firewall.status === 'blocked'
  return (
    <section className="flex flex-col items-center justify-center-safe gap-5 overflow-y-auto rounded-panel bg-surface p-6 text-center [scrollbar-width:thin]">
      {blocked && <FirewallNotice key={firewall.reason} state={firewall} />}
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(state.qrSvg)}`}
        alt={`Pairing QR code for ${origin}`}
        className={`${blocked ? 'size-48' : 'size-60'} shrink-0 rounded-xl bg-white p-3`}
      />
      <div>
        <p className="font-semibold text-xl">Scan with your phone's camera</p>
        <p className="mt-1 text-ink-muted text-sm">
          Same Wi-Fi as this PC. Your phone warns about the certificate once; that is expected.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        {state.hosts.length > 1 ? (
          <label className="flex items-center gap-2">
            <span className="text-ink-muted">Network</span>
            <select
              value={state.host}
              onChange={(event) => void window.shiftpane.pairing.selectHost(event.target.value)}
              className="rounded-lg border border-border bg-surface-raised px-2 py-1 font-mono"
            >
              {state.hosts.map((host) => (
                <option key={host.address} value={host.address}>
                  {host.address} ({host.interface})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="font-mono text-ink-muted">{origin}</span>
        )}
        <button
          type="button"
          onClick={() => void window.shiftpane.pairing.newCode()}
          title="Make a new QR code and disconnect every phone"
          className="rounded-lg border border-border px-3 py-1 hover:border-accent"
        >
          New code
        </button>
      </div>
      <p
        className="max-w-md break-all font-mono text-[10px] text-ink-muted"
        title="Certificate fingerprint (SHA-256)"
      >
        {state.fingerprint}
      </p>
    </section>
  )
}

function Panel({ title, detail, tone }: { title: string; detail?: string; tone?: 'danger' }) {
  return (
    <section className="grid place-items-center rounded-panel bg-surface p-6 text-center">
      <div>
        <p className={`font-semibold text-xl ${tone === 'danger' ? 'text-danger' : ''}`}>{title}</p>
        {detail && <p className="mt-2 max-w-sm text-ink-muted text-sm">{detail}</p>}
      </div>
    </section>
  )
}

function PhoneList({ phones }: { phones: ConnectedPhone[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <h2 className="font-medium text-ink-muted text-sm">Connected phones</h2>
      {phones.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-4 text-center text-ink-muted text-sm">
          None yet
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {phones.map((phone) => (
            <li key={phone.id} className="flex items-center gap-3 rounded-lg bg-surface-raised p-3">
              <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{phone.name}</p>
                <p className="font-mono text-ink-muted text-xs">
                  {Math.round(phone.viewport.width * phone.devicePixelRatio)}×
                  {Math.round(phone.viewport.height * phone.devicePixelRatio)} ·{' '}
                  {phone.address.replace(/^::ffff:/, '')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void window.shiftpane.pairing.disconnect(phone.id)}
                className="rounded-md px-2 py-1 text-danger text-xs hover:bg-surface-sunken"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
