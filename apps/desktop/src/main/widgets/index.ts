import { join } from 'node:path'
import type { MediaAction } from '@shiftpane/helper-client'
import { MEDIA_WIDGET, PC_STATS_WIDGET } from '@shiftpane/protocol'
import { packFolder } from '@shiftpane/widget-runtime'
import type { ActionName } from '@shiftpane/widget-sdk'
import type { ShareResult } from '../../shared/widgets.ts'
import type { PhoneHub } from '../server/phone-hub.ts'
import { fileStorage } from '../storage.ts'
import { MarketplaceAccount } from './account.ts'
import {
  type HelperAccess,
  mediaCollector,
  pcStatsCollector,
  pressMediaButton,
} from './collectors.ts'
import { FolderWatcher } from './folders.ts'
import { Generator } from './generator.ts'
import { InstalledWidgets } from './installed.ts'
import { Marketplace, reportInstall } from './marketplace.ts'
import { Registry } from './registry.ts'
import { type Cipher, WidgetSecrets } from './secrets.ts'
import { WidgetService } from './service.ts'
import { SourceReader } from './sources.ts'
import { InstalledStore } from './store.ts'
import { Studio } from './studio.ts'

export interface WidgetsOptions {
  hub: PhoneHub
  helper: HelperAccess
  /** The app's data folder: installed widgets and their secrets are kept in it. */
  dataDir: string
  /** Where Widget Studio writes the widgets it makes (Documents\ShiftPane widgets). */
  studioDir: string
  appVersion: string
  /** Electron's safeStorage, for widgets' secrets and the marketplace sign-in. */
  cipher: Cipher
  /** Opens a page in the user's browser (GitHub's, to sign in). */
  open?: (url: string) => void
  log?: (message: string) => void
}

export interface Widgets {
  service: WidgetService
  installed: InstalledWidgets
  sources: SourceReader
  marketplace: Marketplace
  account: MarketplaceAccount
  folders: FolderWatcher
  studio: Studio
  generator: Generator
  /** Packs a widget loaded from a folder and uploads it for review, as the signed-in author. */
  share(id: string, notes?: string): Promise<ShareResult>
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
  /** The buttons installed widgets may press, each one fixed call to the helper. */
  const press = async (action: ActionName, value?: number) => {
    const helper = await options.helper()
    switch (action) {
      case 'media.play-pause':
      case 'media.next':
      case 'media.previous':
        await helper.call('media.control', { action: action.slice('media.'.length) as MediaAction })
        sources.forget('media')
        return
      case 'audio.toggle-mute':
        await helper.call('audio.control', { action: 'toggle-mute' })
        sources.forget('audio')
        return
      case 'audio.set-volume':
        if (value === undefined) return
        await helper.call('audio.control', { action: 'set-volume', percent: value })
        sources.forget('audio')
        return
    }
  }
  const installed = new InstalledWidgets({
    store: new InstalledStore(join(options.dataDir, 'widgets'), log),
    secrets: new WidgetSecrets(
      fileStorage(join(options.dataDir, 'widget-secrets.json')),
      options.cipher,
    ),
    sources,
    hub: options.hub,
    appVersion: options.appVersion,
    press,
    log,
  })
  installed.on('pressed', (id) => service.refresh(id))
  // The built-in ids are reserved, so an installed widget never replaces one.
  installed.on('installed', () => service.setCollectors({ ...installed.collectors(), ...builtIn }))
  // The marketplace counts first installs from it; updates and folders aren't counted.
  installed.on('added', ({ id, origin, first }) => {
    if (first && origin.kind === 'marketplace') void reportInstall(id)
  })
  const marketplace = new Marketplace({
    registry: new Registry({ dir: join(options.dataDir, 'registry'), log }),
    installed,
    appVersion: options.appVersion,
    log,
  })
  const account = new MarketplaceAccount({
    storage: fileStorage(join(options.dataDir, 'marketplace-account.json')),
    cipher: options.cipher,
    open: options.open,
    log,
  })
  const folders = new FolderWatcher({ installed, log })
  const studio = new Studio({
    installed,
    folder: options.studioDir,
    storage: fileStorage(join(options.dataDir, 'studio-recipes.json')),
    appVersion: options.appVersion,
  })
  const generator = new Generator({ log: (message) => log(`generator: ${message}`) })
  void installed.start().then(() => marketplace.start())
  void account.load()
  return {
    service,
    installed,
    sources,
    marketplace,
    account,
    folders,
    studio,
    generator,
    async share(id, notes) {
      const origin = installed.origin(id)
      if (origin?.kind !== 'folder') {
        return { ok: false, problems: ['Only a widget loaded from a folder can be shared.'] }
      }
      const packed = await packFolder(origin.path)
      if (!packed.ok) return { ok: false, problems: packed.report.problems }
      return account.upload(packed.zip, notes)
    },
    stop() {
      service.stop()
      installed.stop()
      sources.stop()
      marketplace.stop()
      account.cancel()
      folders.stop()
      generator.cancel()
    },
  }
}

export { WidgetService } from './service.ts'
