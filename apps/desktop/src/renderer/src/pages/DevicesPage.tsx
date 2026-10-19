import { MAX_PHONES } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import type { DisplayState } from '../../../shared/display.ts'
import type { FirewallState } from '../../../shared/firewall.ts'
import type {
  ConnectedPhone,
  PairingCodeState,
  PairingState,
  RememberedPhone,
} from '../../../shared/pairing.ts'
import { DisplayNotice } from '../DisplayNotice.tsx'
import { FirewallNotice } from '../FirewallNotice.tsx'
import { Button, Card, Chip, Dot, type DotTone, Glyph, Select } from '../shell/parts.tsx'
import { splitName } from '../splits.ts'

/** The phone's screen in physical pixels, as it is now (or as it was when it paired). */
function screenPixels(phone: ConnectedPhone): string {
  const viewport = phone.screen?.viewport ?? phone.viewport
  const ratio = phone.screen?.devicePixelRatio ?? phone.devicePixelRatio
  return `${Math.round(viewport.width * ratio)} × ${Math.round(viewport.height * ratio)}`
}

/** One line about the virtual monitor, under its size or state. */
export function describeDisplay(display: DisplayState, phones: ConnectedPhone[]): string {
  switch (display.status) {
    case 'unknown':
      return 'Checking the display driver…'
    case 'idle':
      return 'One appears when a phone asks for it.'
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

/** The card's status chip, and its big line while there is no monitor size to show. */
const DISPLAY_STATUS: Record<
  DisplayState['status'],
  { label: string; dot: DotTone; headline: string }
> = {
  unknown: { label: 'Checking', dot: 'off', headline: 'Checking…' },
  idle: { label: 'Ready', dot: 'off', headline: 'No monitor' },
  working: { label: 'Setting up', dot: 'busy', headline: 'Preparing' },
  attached: { label: 'Streaming', dot: 'ok', headline: '' },
  problem: { label: 'Needs a look', dot: 'warn', headline: 'Unavailable' },
}

/** The virtual monitor's state, with its notice when it needs the user. */
export function DisplayCard({
  display,
  phones,
}: {
  display: DisplayState
  phones: ConnectedPhone[]
}) {
  const status = DISPLAY_STATUS[display.status]
  const notice = display.status === 'working' || display.status === 'problem'
  const size =
    display.status === 'attached' || display.status === 'working' ? display.size : undefined
  return (
    <Card
      title="Virtual monitor"
      icon="monitor"
      aside={
        <Chip className="gap-2">
          <Dot tone={status.dot} className="size-1.5" />
          {status.label}
        </Chip>
      }
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-normal text-[2rem] leading-none tracking-tight tabular-nums">
            {size ? `${size.width} × ${size.height}` : status.headline}
          </p>
          {!notice && (
            <p className="mt-2.5 text-ink-muted text-sm">{describeDisplay(display, phones)}</p>
          )}
        </div>
        <Glyph icon="monitor" />
      </div>
      {notice && (
        <div className="mt-4">
          <DisplayNotice state={display} />
        </div>
      )}
    </Card>
  )
}

/** "123456" as "123 456", easier to read out and type. */
const spaced = (digits: string) => `${digits.slice(0, 3)} ${digits.slice(3)}`

/** The code to type on a phone that cannot use the QR code, like an app on an iPhone's home screen. */
function TypedCode({ code }: { code: PairingCodeState }) {
  return (
    <div className="-mt-3 flex flex-col items-center gap-1.5 text-center">
      <span className="section-label">Or type this code in the phone app</span>
      <p
        className={`font-mono text-[1.75rem] leading-none tracking-[0.18em] tabular-nums ${
          code.locked ? 'text-ink-faint line-through' : ''
        }`}
      >
        {spaced(code.digits)}
      </p>
      <p className={`text-xs ${code.locked ? 'text-danger' : 'text-ink-muted'}`}>
        {code.locked
          ? 'Too many wrong tries. Press New code for another.'
          : 'For ShiftPane on a home screen. A new one comes every 10 minutes.'}
      </p>
    </div>
  )
}

function PairCard({ state, firewall }: { state: PairingState; firewall: FirewallState }) {
  if (state.status !== 'ready') {
    return (
      <Card
        title="Pair a phone"
        icon="qr"
        bodyClassName="items-center justify-center p-8 text-center"
      >
        <p className={`font-medium text-lg ${state.status === 'error' ? 'text-danger' : ''}`}>
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
    "Scan the QR code with the phone's camera.",
    'Accept the certificate warning once; it is expected.',
  ]
  return (
    <Card
      title="Pair a phone"
      icon="qr"
      aside={
        <Button
          icon="refresh"
          onClick={() => void window.shiftpane.pairing.newCode()}
          title="Make a new QR code and pairing code. Paired phones stay connected."
        >
          New code
        </Button>
      }
    >
      {firewall.status === 'blocked' && (
        <div className="mb-4">
          <FirewallNotice key={firewall.reason} state={firewall} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
        <div className="hatched rounded-[1.375rem] border border-border bg-surface p-2">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(state.qrSvg)}`}
            alt={`Pairing code for ${origin}`}
            className="size-52 shrink-0 rounded-2xl bg-white p-3.5"
          />
        </div>
        <TypedCode code={state.code} />
        <div className="w-full max-w-sm">
          <ol className="flex flex-col gap-3">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span className="raised grid size-6 shrink-0 place-items-center rounded-md font-mono text-[11px] text-ink-soft tabular-nums">
                  {index + 1}
                </span>
                <span className="text-ink-soft">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            {state.hosts.length > 1 ? (
              <div className="flex flex-col gap-2">
                <span className="section-label">Network</span>
                <Select
                  aria-label="Network"
                  icon="network"
                  value={state.host}
                  onChange={(event) => void window.shiftpane.pairing.selectHost(event.target.value)}
                  className="w-full font-mono"
                >
                  {state.hosts.map((host) => (
                    <option key={host.address} value={host.address}>
                      {host.address} ({host.interface})
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-ink-muted text-xs">
                <Icon name="network" className="size-4" />
                {origin}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

const lastSeen = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function ForgetButton({ phone }: { phone: { deviceId: string; name: string } }) {
  return (
    <Button
      tone="ghost"
      icon="trash"
      onClick={() => void window.shiftpane.pairing.forget(phone.deviceId)}
      title={`Forget ${phone.name}: it has to pair again to connect`}
      aria-label={`Forget ${phone.name}`}
      className="hover:text-danger"
    />
  )
}

function PhonesCard({
  phones,
  remembered,
  display,
}: {
  phones: ConnectedPhone[]
  remembered: RememberedPhone[]
  display: DisplayState
}) {
  const connected = new Set(phones.map((phone) => phone.deviceId))
  const away = remembered.filter((phone) => !connected.has(phone.deviceId))
  return (
    <Card
      title="Phones"
      icon="devices"
      aside={
        <Chip>
          {phones.length} / {MAX_PHONES}
        </Chip>
      }
      className="flex-1"
      bodyClassName="p-2"
    >
      {phones.length === 0 && away.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div>
            <span className="raised mx-auto mb-3 grid size-11 place-items-center rounded-xl text-ink-muted">
              <Icon name="qr" className="size-5" />
            </span>
            <p className="font-medium text-sm">No phones yet</p>
            <p className="mt-1 text-ink-muted text-xs">Scan the code to connect one.</p>
          </div>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto [scrollbar-width:thin]">
          {phones.map((phone) => {
            const monitor =
              display.status === 'attached' && display.phoneId === phone.id ? display.size : null
            return (
              <li
                key={phone.id}
                className="flex items-center gap-3 rounded-[0.625rem] border border-border bg-surface/60 p-2.5"
              >
                <span className="raised relative grid size-10 shrink-0 place-items-center rounded-lg text-ink-soft">
                  <Icon name="phone" className="size-5" />
                  <Dot tone="ok" className="absolute -top-0.5 -right-0.5 ring-2 ring-surface" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{phone.name}</p>
                  <p className="truncate font-mono text-[11px] text-ink-muted tabular-nums">
                    {screenPixels(phone)}
                    {phone.screen ? ` · ${splitName(phone.screen.monitorFraction)}` : ''} ·{' '}
                    {phone.address.replace(/^::ffff:/, '')}
                  </p>
                  {monitor && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-ok text-xs tabular-nums">
                      <Icon name="monitor" className="size-3.5" />
                      Monitor {monitor.width} × {monitor.height}
                    </p>
                  )}
                </div>
                <Button
                  tone="ghost"
                  icon="unlink"
                  onClick={() => void window.shiftpane.pairing.disconnect(phone.id)}
                  title="Disconnect for now; the phone stays paired"
                  className="hover:text-danger"
                >
                  Disconnect
                </Button>
                <ForgetButton phone={phone} />
              </li>
            )
          })}
          {away.map((phone) => (
            <li
              key={phone.deviceId}
              className="flex items-center gap-3 rounded-[0.625rem] border border-border border-dashed p-2.5"
            >
              <span className="raised relative grid size-10 shrink-0 place-items-center rounded-lg text-ink-muted">
                <Icon name="phone" className="size-5" />
                <Dot tone="off" className="absolute -top-0.5 -right-0.5 ring-2 ring-surface" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-soft text-sm">{phone.name}</p>
                <p className="truncate text-[11px] text-ink-muted">
                  Paired · last seen {lastSeen(phone.lastSeenAt)}
                </p>
              </div>
              <ForgetButton phone={phone} />
            </li>
          ))}
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
  const remembered = pairing.status === 'ready' ? pairing.remembered : []
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
      <PairCard state={pairing} firewall={firewall} />
      <div className="flex min-h-0 flex-col gap-4">
        <PhonesCard phones={phones} remembered={remembered} display={display} />
        <DisplayCard display={display} phones={phones} />
      </div>
    </div>
  )
}
