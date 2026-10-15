import {
  type HelperDisplay,
  matchDisplay,
  matchSource,
  type Rect,
  type ScreenDisplay,
  type ScreenSource,
} from './match.ts'

/** The part of Electron's `screen` module used to list displays. */
export interface ScreenModule {
  getAllDisplays(): Array<{ id: number; label: string; bounds: Rect }>
  /** DIPs to physical pixels; `null` converts in the desktop's own coordinate space. */
  dipToScreenRect(window: null, rect: Rect): Rect
}

/** The part of Electron's `desktopCapturer` used to list capture sources. */
export interface ScreenCapturer<Source extends ScreenSource> {
  getSources(options: {
    types: ['screen']
    thumbnailSize: { width: 0; height: 0 }
  }): Promise<Source[]>
}

export interface FindSourceOptions {
  /** How many times to look before giving up. */
  attempts?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

/** The monitor never showed up in Electron's list. Its message is shown to the phone's user. */
export class CaptureSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureSourceError'
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The capture source for the virtual monitor the helper just attached.
 *
 * Windows applies the new mode before the helper returns, but Electron's display list follows a
 * moment later, so a monitor that is not there yet is looked for again for a few seconds.
 * `screen.getAllDisplays()` runs before every `getSources`: Electron leaves each source's
 * `display_id` empty until the screen module has listed the displays.
 */
export async function findCaptureSource<Source extends ScreenSource>(
  target: HelperDisplay,
  screen: ScreenModule,
  capturer: ScreenCapturer<Source>,
  options: FindSourceOptions = {},
): Promise<{ source: Source; display: ScreenDisplay; by: string }> {
  const { attempts = 25, intervalMs = 200, sleep = defaultSleep, log = () => {} } = options
  const began = Date.now()
  let problem = 'the monitor was not found'

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const displays: ScreenDisplay[] = screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: display.label,
      physicalBounds: screen.dipToScreenRect(null, display.bounds),
    }))
    const matched = matchDisplay(target, displays)

    if (matched.ok) {
      const sources = await capturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      })
      const found = matchSource(matched.display, sources)
      if (found.ok) {
        log(
          `capturing ${found.source.id} (display ${matched.display.id}, matched by ${matched.by}, ` +
            `found in ${Date.now() - began} ms) for ${target.id}`,
        )
        return { source: found.source, display: matched.display, by: matched.by }
      }
      problem =
        found.reason === 'no-display-ids'
          ? 'Electron did not report which display each capture source shows'
          : `display ${matched.display.id} has no capture source`
    } else {
      problem =
        matched.reason === 'ambiguous'
          ? 'more than one display looks like the virtual monitor'
          : `no display is at ${target.x},${target.y} ${target.width}x${target.height}`
      // A refused match that will not get better by waiting.
      if (matched.reason === 'ambiguous') break
    }

    if (attempt < attempts) await sleep(intervalMs)
  }

  const known = screen
    .getAllDisplays()
    .map((display) => {
      const { x, y, width, height } = screen.dipToScreenRect(null, display.bounds)
      return `${display.id} "${display.label}" ${width}x${height}@${x},${y}`
    })
    .join('; ')
  log(`no capture source for ${target.id}: ${problem}. Displays: ${known}`)
  throw new CaptureSourceError(`Could not capture the virtual monitor: ${problem}.`)
}
