import { statSync } from 'node:fs'
import { HELPER_PROTOCOL_VERSION } from '@shiftpane/helper-client'
import { DisplayController } from './controller.ts'
import { HelperHost } from './helper-host.ts'
import { openHelperProcess } from './helper-process.ts'
import { locateHelper } from './locate.ts'

export interface DisplayServiceOptions {
  /** `app.isPackaged`. */
  packaged: boolean
  resourcesPath: string
  appPath: string
  log?: (message: string) => void
}

/** The virtual-monitor controller wired to the real helper executable. */
export function createDisplayController(options: DisplayServiceOptions): DisplayController {
  const log = options.log ?? ((message: string) => console.info(`[display] ${message}`))
  const host = new HelperHost({
    expectedProtocol: HELPER_PROTOCOL_VERSION,
    log,
    locate: () =>
      locateHelper({
        packaged: options.packaged,
        platform: process.platform,
        resourcesPath: options.resourcesPath,
        appPath: options.appPath,
        env: process.env,
        mtimeMs: (path) => {
          try {
            const stats = statSync(path)
            return stats.isFile() ? stats.mtimeMs : null
          } catch {
            return null
          }
        },
      }),
    open: openHelperProcess,
  })
  return new DisplayController({ host, log })
}

export type { DisplayController } from './controller.ts'
export { bindDisplayToHub } from './hub.ts'
