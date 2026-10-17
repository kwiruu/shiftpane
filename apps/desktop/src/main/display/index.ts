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

const defaultLog = (message: string) => console.info(`[display] ${message}`)

/**
 * The one helper process, wired to the real executable. The display controller drives the
 * virtual monitor through it, and the widgets read PC stats and media through the same process.
 */
export function createHelperHost(options: DisplayServiceOptions): HelperHost {
  return new HelperHost({
    expectedProtocol: HELPER_PROTOCOL_VERSION,
    log: options.log ?? defaultLog,
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
}

/** The virtual-monitor controller, on the shared helper. */
export function createDisplayController(
  host: HelperHost,
  log: (message: string) => void = defaultLog,
): DisplayController {
  return new DisplayController({ host, log })
}

export type { DisplayController } from './controller.ts'
export type { HelperHost } from './helper-host.ts'
export { bindDisplayToHub } from './hub.ts'
