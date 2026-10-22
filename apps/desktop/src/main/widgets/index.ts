import { join } from 'node:path'
import { MEDIA_WIDGET, PC_STATS_WIDGET } from '@shiftpane/protocol'
import type { PhoneHub } from '../server/phone-hub.ts'
import { fileStorage } from '../storage.ts'
import {
  type HelperAccess,
  mediaCollector,
  pcStatsCollector,
  pressMediaButton,
} from './collectors.ts'
import { InstalledWidgets } from './installed.ts'
import { type Cipher, WidgetSecrets } from './secrets.ts'
import { WidgetService } from './service.ts'
import { SourceReader } from './sources.ts'
import { InstalledStore } from './store.ts'

export interface WidgetsOptions {
  hub: PhoneHub
  helper: HelperAccess
  /** The app's data folder: installed widgets and their secrets are kept in it. */
  dataDir: string
  appVersion: string
  /** Electron's safeStorage, for widgets' secrets. */
  cipher: Cipher
  log?: (message: string) => void
}

export interface Widgets {
  service: WidgetService
  installed: InstalledWidgets
  sources: SourceReader
  stop(): void
}

/**
 * The widgets that need the PC: PC stats and media (read through the helper), and every widget
 * installed on this PC, each run while some phone shows it.
 */
export function startWidgets(options: WidgetsOptions): Widgets {
  const log = options.log ?? ((message: string) => console.info(`[widgets] ${message}`))
  const builtIn = {
    [PC_STATS_WIDGET]: pcStatsCollector(options.helper),
    [MEDIA_WIDGET]: mediaCollector(options.helper),
  }
  const service = new WidgetService({
    hub: options.hub,
    collectors: builtIn,
    mediaControl: pressMediaButton(options.helper),
    mediaWidget: MEDIA_WIDGET,
    log,
  })
  const sources = new SourceReader({ helper: options.helper, log })
  const installed = new InstalledWidgets({
    store: new InstalledStore(join(options.dataDir, 'widgets'), log),
    secrets: new WidgetSecrets(
      fileStorage(join(options.dataDir, 'widget-secrets.json')),
      options.cipher,
    ),
    sources,
    hub: options.hub,
    appVersion: options.appVersion,
    log,
  })
  // The built-in ids are reserved, so an installed widget never replaces one.
  installed.on('installed', () => service.setCollectors({ ...installed.collectors(), ...builtIn }))
  void installed.start()
  return {
    service,
    installed,
    sources,
    stop() {
      service.stop()
      installed.stop()
      sources.stop()
    },
  }
}

export { WidgetService } from './service.ts'
