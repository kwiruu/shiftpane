import { useState } from 'react'
import { LayoutEditor } from './layout/LayoutEditor.tsx'
import { DevicesPage } from './pages/DevicesPage.tsx'
import { MarketplacePage } from './pages/MarketplacePage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
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
  marketplace: 'Marketplace',
  settings: 'Settings',
}

export function App() {
  const pairing = usePairing()
  const firewall = useFirewall()
  const display = useDisplay()
  const [board, setBoard] = useBoard()
  const [view, setView] = useState<View>('devices')
  const phones = pairing.status === 'ready' ? pairing.phones : []
  // Only the pages that show widgets keep the sample data ticking.
  const sampleUser = view === 'marketplace'

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
          {view === 'marketplace' && sampleUser && (
            <Marketplace board={board} onChange={setBoard} />
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

/** The marketplace with live previews; mounted only while it is open, so the samples stop. */
function Marketplace(props: Omit<Parameters<typeof MarketplacePage>[0], 'data'>) {
  const data = useSampleData()
  return <MarketplacePage {...props} data={data} />
}
