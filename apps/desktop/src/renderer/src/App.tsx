import { useEffect, useState } from 'react'
import { LayoutEditor } from './layout/LayoutEditor.tsx'
import { DevicesPage } from './pages/DevicesPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { WidgetsPage } from './pages/WidgetsPage.tsx'
import { Sidebar, type View } from './shell/Sidebar.tsx'
import { TitleBar } from './shell/TitleBar.tsx'
import { useBoard } from './useBoard.ts'
import { useDisplay } from './useDisplay.ts'
import { useFirewall } from './useFirewall.ts'
import { usePairing } from './usePairing.ts'
import { useSampleData } from './useSampleData.ts'

const TITLES: Record<View, string> = {
  devices: 'Devices',
  layout: 'Phone layout',
  widgets: 'Widgets',
  settings: 'Settings',
}

export function App() {
  const pairing = usePairing()
  const firewall = useFirewall()
  const display = useDisplay()
  const [board, setBoard] = useBoard()
  const [view, setView] = useState<View>('devices')
  // A widget an install link (shiftpane://install/<id>) asked for, until the Widgets page shows it.
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    const open = (id: string) => {
      setView('widgets')
      setOpenId(id)
    }
    void window.shiftpane.store.takeOpen().then((id) => {
      if (id) open(id)
    })
    return window.shiftpane.store.onOpen(open)
  }, [])
  const phones = pairing.status === 'ready' ? pairing.phones : []
  // Only the pages that show widgets keep the sample data ticking.
  const sampleUser = view === 'widgets'

  return (
    <div className="flex h-full bg-surface-sunken text-ink">
      <Sidebar view={view} onView={setView} phones={phones} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar title={TITLES[view]} />

        <main className="min-h-0 flex-1 p-5">
          {view === 'devices' && (
            <DevicesPage pairing={pairing} firewall={firewall} display={display} />
          )}
          {view === 'layout' && <LayoutEditor phones={phones} />}
          {view === 'widgets' && sampleUser && (
            <Widgets
              board={board}
              onChange={setBoard}
              openId={openId}
              onOpened={() => setOpenId(null)}
            />
          )}
          {view === 'settings' && (
            <SettingsPage
              pairing={pairing}
              firewall={firewall}
              display={display}
              board={board}
              onBoard={setBoard}
            />
          )}
        </main>
      </div>
    </div>
  )
}

/** The widgets with live previews; mounted only while the page is open, so the samples stop. */
function Widgets(props: Omit<Parameters<typeof WidgetsPage>[0], 'data'>) {
  const data = useSampleData()
  return <WidgetsPage {...props} data={data} />
}
