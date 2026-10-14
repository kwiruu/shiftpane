const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const

/** Placeholder window. The pairing QR, connected phones and widget settings replace it. */
export function App() {
  const { platform, versions } = window.shiftpane

  return (
    <main className="grid h-full grid-cols-[1fr_18rem] gap-6 bg-surface-sunken p-6 text-ink">
      <section className="grid place-items-center rounded-panel border border-border border-dashed bg-surface">
        <div className="text-center">
          <p className="font-semibold text-xl">Pair a phone</p>
          <p className="mt-2 max-w-xs text-ink-muted text-sm">
            The pairing QR code appears here once the local server is in place.
          </p>
        </div>
      </section>
      <aside className="flex flex-col gap-3 rounded-panel bg-surface p-5 text-sm">
        <h1 className="font-semibold text-lg">ShiftPane</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink-muted">
          <dt>Platform</dt>
          <dd className="text-ink">{PLATFORM_LABEL[platform]}</dd>
          <dt>Version</dt>
          <dd className="font-mono text-ink">{versions.app}</dd>
          <dt>Electron</dt>
          <dd className="font-mono text-ink">{versions.electron}</dd>
        </dl>
      </aside>
    </main>
  )
}
