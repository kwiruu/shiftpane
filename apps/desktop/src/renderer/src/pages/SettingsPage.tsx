import { DEFAULT_BOARD } from '@shiftpane/board'
import type { Board } from '@shiftpane/protocol'
import { type ReactNode, useState } from 'react'
import type { DisplayState } from '../../../shared/display.ts'
import type { FirewallState } from '../../../shared/firewall.ts'
import type { PairingState } from '../../../shared/pairing.ts'
import { FirewallNotice } from '../FirewallNotice.tsx'
import { Logo, ShellIcon } from '../shell/icons.tsx'
import { Card, DisplayCard } from './DevicesPage.tsx'

const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-border/60 border-b py-2.5 text-sm last:border-b-0">
      <span className="text-ink-muted">{label}</span>
      <span className="truncate text-right font-medium tabular-nums">{children}</span>
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
  const { platform, versions } = window.shiftpane
  const phones = pairing.status === 'ready' ? pairing.phones : []
  const widgets = board.tables.reduce((total, table) => total + table.widgets.length, 0)

  return (
    <div className="grid h-full min-h-0 auto-rows-min grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] gap-5 overflow-y-auto [scrollbar-width:thin]">
      <Card title="About">
        <div className="mb-3 flex items-center gap-4">
          <Logo className="size-14" />
          <div>
            <p className="font-semibold text-lg">ShiftPane</p>
            <p className="text-ink-muted text-sm">
              Version {versions.app} · {PLATFORM_LABEL[platform]}
            </p>
          </div>
        </div>
        <Fact label="Electron">{versions.electron}</Fact>
        <Fact label="Chromium">{versions.chrome}</Fact>
        <Fact label="Node.js">{versions.node}</Fact>
      </Card>

      <Card
        title="Network"
        aside={
          <span
            className={`size-2 rounded-full ${firewall.status === 'blocked' ? 'bg-warn' : 'bg-ok'}`}
            aria-hidden
          />
        }
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

      <Card title="Phone layout">
        <Fact label="Tables">{board.tables.length}</Fact>
        <Fact label="Widgets">{widgets}</Fact>
        <button
          type="button"
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true)
              return
            }
            onBoard(DEFAULT_BOARD)
            setConfirmReset(false)
          }}
          onBlur={() => setConfirmReset(false)}
          className="mt-4 flex items-center justify-center gap-2 rounded-full border border-border py-2 text-danger text-sm transition hover:border-danger"
        >
          <ShellIcon name="refresh" className="size-4" />
          {confirmReset ? 'Click again to replace every table' : 'Reset to the default tables'}
        </button>
      </Card>
    </div>
  )
}
