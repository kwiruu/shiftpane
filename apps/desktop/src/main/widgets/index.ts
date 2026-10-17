import { MEDIA_WIDGET, PC_STATS_WIDGET } from '@shiftpane/protocol'
import type { PhoneHub } from '../server/phone-hub.ts'
import {
  type HelperAccess,
  mediaCollector,
  pcStatsCollector,
  pressMediaButton,
} from './collectors.ts'
import { WidgetService } from './service.ts'

export interface WidgetsOptions {
  hub: PhoneHub
  helper: HelperAccess
  log?: (message: string) => void
}

/** The built-in widgets that need the PC: PC stats and media, both read through the helper. */
export function startWidgets(options: WidgetsOptions): WidgetService {
  const log = options.log ?? ((message: string) => console.info(`[widgets] ${message}`))
  return new WidgetService({
    hub: options.hub,
    collectors: {
      [PC_STATS_WIDGET]: pcStatsCollector(options.helper),
      [MEDIA_WIDGET]: mediaCollector(options.helper),
    },
    mediaControl: pressMediaButton(options.helper),
    mediaWidget: MEDIA_WIDGET,
    log,
  })
}

export { WidgetService } from './service.ts'
