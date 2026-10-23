import { DEFAULT_BOARD } from '@shiftpane/board'
import type { Board } from '@shiftpane/protocol'
import { type ReactNode, useState } from 'react'
import { type DisplayState, SCALE_CHOICES } from '../../../shared/display.ts'
import type { FirewallState } from '../../../shared/firewall.ts'
import type { PairingState } from '../../../shared/pairing.ts'
import { FirewallNotice } from '../FirewallNotice.tsx'
import { Segmented } from '../layout/controls.tsx'
import { Logo } from '../shell/Logo.tsx'
import { Button, Card, Dot, Select } from '../shell/parts.tsx'
import { useInstalled } from '../useInstalled.ts'
import { useSettings } from '../useSettings.ts'
import { DisplayCard } from './DevicesPage.tsx'

const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-border border-b py-2.5 text-sm last:border-b-0">
      <span className="text-ink-muted">{label}</span>
      <span className="truncate text-right font-mono text-[13px] text-ink-soft tabular-nums">
        {children}
      </span>
    </div>
  )
}

function firewallLine(firewall: FirewallState): string {
  switch (firewall.status) {
    case 'unknown':
      return 'Not checked on this system'
    case 'blocked':
      return 'Blocking phones'
    case 'ok':
      return 'Phones can connect'
  }
}

/** The app, its network, the virtual monitor and the phone layout, at a glance. */
export function SettingsPage({
  pairing,
  firewall,
  display,
  board,
  onBoard,
}: {
  pairing: PairingState
  firewall: FirewallState
  display: DisplayState
  board: Board
  onBoard: (board: Board) => void
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [settings, setSettings] = useSettings()
  const installed = useInstalled()
  const { platform, versions } = window.shiftpane
  const phones = pairing.status === 'ready' ? pairing.phones : []
  const widgets = board.tables.reduce((total, table) => total + table.widgets.length, 0)

  return (
    <div className="grid h-full min-h-0 auto-rows-min grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] gap-4 overflow-y-auto [scrollbar-width:thin]">
      <Card title="About" icon="info">
        <div className="mb-3 flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl border border-border bg-surface">
            <Logo className="size-9" />
          </span>
          <div>
            <p className="font-semibold text-lg tracking-tight">ShiftPane</p>
            <p className="font-mono text-ink-muted text-xs">
              v{versions.app} · {PLATFORM_LABEL[platform]}
            </p>
          </div>
        </div>
        <Fact label="Electron">{versions.electron}</Fact>
        <Fact label="Chromium">{versions.chrome}</Fact>
        <Fact label="Node.js">{versions.node}</Fact>
      </Card>

      <Card
        title="Network"
        icon="network"
        aside={<Dot tone={firewall.status === 'blocked' ? 'warn' : 'ok'} className="mr-2" />}
      >
        {pairing.status === 'ready' ? (
          <>
            <Fact label="Address">
              {pairing.host}:{pairing.port}
            </Fact>
            <Fact label="Firewall">{firewallLine(firewall)}</Fact>
            <Fact label="Phones">{phones.length} connected</Fact>
          </>
        ) : (
          <p className="text-ink-muted text-sm">
            {pairing.status === 'error' ? pairing.message : 'Starting the local server…'}
          </p>
        )}
        {firewall.status === 'blocked' && (
          <div className="mt-3">
            <FirewallNotice key={firewall.reason} state={firewall} />
          </div>
        )}
      </Card>

      <DisplayCard display={display} phones={phones} />

      {platform === 'windows' && (
        <Card title="Monitor scale" icon="monitor">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Text size on the phone's monitor</p>
              <p className="mt-1 text-ink-muted text-sm">
                Matching the phone makes text the size it is in the phone's own apps. Windows may
                cap it on a small monitor.
              </p>
            </div>
            <Select
              aria-label="Monitor scale"
              className="w-44 shrink-0"
              value={String(settings.monitorScale)}
              onChange={(event) => {
                const value = event.target.value
                setSettings({
                  monitorScale: value === 'phone' || value === 'os' ? value : Number(value),
                })
              }}
            >
              <option value="phone">Match the phone</option>
              <option value="os">Leave it to Windows</option>
              {SCALE_CHOICES.map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </Select>
          </div>
        </Card>
      )}

      <Card title="Phone layout" icon="layout">
        <Fact label="Tables">{board.tables.length}</Fact>
        <Fact label="Widgets">{widgets}</Fact>
        <Button
          tone="danger"
          icon="reset"
          size="md"
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true)
              return
            }
            onBoard(DEFAULT_BOARD)
            setConfirmReset(false)
          }}
          onBlur={() => setConfirmReset(false)}
          className="mt-4 w-full"
        >
          {confirmReset ? 'Click again to replace every table' : 'Reset to the default tables'}
        </Button>
      </Card>

      <Card title="Developer" icon="widget-add">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Developer mode</p>
            <p className="mt-1 text-ink-muted text-sm">
              Load widgets from a folder on this PC, to make your own or try one before it's in the
              marketplace. Find it under Widgets, Installed.
            </p>
          </div>
          <Segmented
            label="Developer mode"
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            value={settings.developerMode ? 'on' : 'off'}
            onChange={(next) => setSettings({ developerMode: next === 'on' })}
          />
        </div>
        <div className="mt-3">
          <Fact label="Installed widgets">{installed.length}</Fact>
        </div>
      </Card>
    </div>
  )
}
