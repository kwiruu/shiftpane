import type { DisplayInfo, HelloInfo, HelperError } from '@shiftpane/helper-client'
import { HelperCallError } from '@shiftpane/helper-client'
import { computeSplit, SPLIT_PRESETS, type SplitPreset } from '@shiftpane/layout'
import { describe, expect, it, vi } from 'vitest'
import type { DisplayState, MonitorSize } from '../../shared/display.ts'
import { DisplayController, type DisplayControllerOptions, type PairedPhone } from './controller.ts'
import type { HelperChannel } from './helper-host.ts'
import { sizesForPhone } from './sizes.ts'

interface Recorded {
  method: string
  params: unknown
}

const readyHello = (overrides: Partial<HelloInfo['backend']> = {}): HelloInfo => ({
  protocolVersion: 2,
  helperVersion: '0.1.0',
  platform: 'windows',
  backend: {
    name: 'vdd',
    ready: true,
    capabilities: {
      virtualDisplay: true,
      resize: true,
      scaling: false,
      inputInjection: true,
      windowControl: true,
    },
    ...overrides,
  },
})

const failure = (code: HelperError['code'], message: string) =>
  new HelperCallError({ code, message })

const phone = (id: string, viewport = { width: 800, height: 360 }): PairedPhone => ({
  id,
  viewport,
  devicePixelRatio: 3,
})

const SIZES = [
  { width: 1440, height: 1080 },
  { width: 1080, height: 1440 },
]

/** One size per viewport, so tests can tell which viewport a prepare came from. */
const scaled: NonNullable<DisplayControllerOptions['sizesFor']> = (viewport, devicePixelRatio) => [
  { width: viewport.width * devicePixelRatio, height: viewport.height * devicePixelRatio },
]

type Responder = (call: Recorded) => unknown | Promise<unknown>

function setup(
  responder: Responder = () => undefined,
  sizesFor: NonNullable<DisplayControllerOptions['sizesFor']> = () => SIZES,
) {
  const calls: Recorded[] = []
  const exitListeners: Array<() => void> = []
  let override = responder

  const defaults: Responder = ({ method, params }) => {
    switch (method) {
      case 'helper.hello':
        return { type: 'hello', ...readyHello() }
      case 'display.prepare':
        return { type: 'prepared', added: 0 }
      case 'display.attach': {
        const { width, height, refreshHz } = params as {
          width: number
          height: number
          refreshHz: number
        }
        const display: DisplayInfo = {
          id: String.raw`\\.\DISPLAY9`,
          name: 'VDD by MTT',
          x: 1920,
          y: 0,
          width,
          height,
          refreshHz,
          scaleFactor: 1,
          primary: false,
          virtualDisplay: true,
        }
        return { type: 'attached', display }
      }
      case 'display.detach':
        return { type: 'detached' }
      default:
        throw new Error(`unexpected ${method}`)
    }
  }

  const channel = {
    call: async (method: string, params?: unknown) => {
      const call = { method, params }
      calls.push(call)
      const custom = await override(call)
      if (custom instanceof Error) throw custom
      return custom === undefined ? defaults(call) : custom
    },
    close: vi.fn(),
  } as unknown as HelperChannel

  const host = {
    session: vi.fn(async () => ({ channel, hello: readyHello() })),
    stop: vi.fn(async () => {}),
    on: (_event: 'exit', listener: () => void) => {
      exitListeners.push(listener)
    },
  }

  const controller = new DisplayController({ host, sizesFor, stopGraceMs: 50 })
  const states: DisplayState[] = []
  controller.on('change', (state) => states.push(state))
  const events: string[] = []
  controller.on('attached', ({ phoneId, display }) =>
    events.push(`attached ${phoneId} ${display.width}x${display.height}`),
  )
  controller.on('detached', ({ phoneId }) => events.push(`detached ${phoneId}`))
  controller.on('failed', ({ phoneId, problem }) =>
    events.push(`failed ${phoneId} ${problem.reason}`),
  )
  controller.on('preempted', ({ phoneId, by }) => events.push(`preempted ${phoneId} by ${by}`))

  const methods = () => calls.map((c) => c.method)
  const attaches = () =>
    calls
      .filter((c) => c.method === 'display.attach')
      .map((c) => {
        const { width, height } = c.params as { width: number; height: number }
        return `${width}x${height}`
      })
  /** The size lists sent in each `display.prepare`, as `WxH` strings. */
  const prepares = () =>
    calls
      .filter((c) => c.method === 'display.prepare')
      .map((c) => (c.params as { sizes: MonitorSize[] }).sizes.map((s) => `${s.width}x${s.height}`))
  return {
    controller,
    host,
    calls,
    methods,
    attaches,
    prepares,
    states,
    events,
    respondWith: (next: Responder) => {
      override = next
    },
    exit: () => {
      for (const listener of exitListeners) listener()
    },
  }
}

const settled = (controller: DisplayController, status: DisplayState['status']) =>
  vi.waitFor(() => expect(controller.state.status).toBe(status))

describe('DisplayController: backend state', () => {
  it('is idle and available when the backend is ready', async () => {
    const { controller } = setup()
    await controller.start()
    expect(controller.state).toEqual({ status: 'idle' })
    expect(controller.available).toBe(true)
  })

  it('reports a missing driver with the helper’s install hint', async () => {
    const hint = 'Install Virtual Display Driver: run `winget install ...`, then click Install'
    const { controller } = setup(({ method }) =>
      method === 'helper.hello'
        ? { type: 'hello', ...readyHello({ ready: false, reason: hint }) }
        : undefined,
    )
    await controller.start()
    expect(controller.state).toEqual({
      status: 'problem',
      reason: 'driver-missing',
      message: hint,
      size: null,
    })
    expect(controller.available).toBe(false)
  })

  it('calls any other not-ready backend unsupported', async () => {
    const { controller } = setup(({ method }) =>
      method === 'helper.hello'
        ? {
            type: 'hello',
            ...readyHello({ name: 'unsupported', ready: false, reason: 'not here yet' }),
          }
        : undefined,
    )
    await controller.start()
    expect(controller.state).toMatchObject({ status: 'problem', reason: 'unsupported' })
  })

  it('notices the driver being installed on a recheck', async () => {
    let ready = false
    const { controller } = setup(({ method }) =>
      method === 'helper.hello'
        ? { type: 'hello', ...readyHello({ ready, reason: ready ? undefined : 'missing' }) }
        : undefined,
    )
    await controller.start()
    expect(controller.available).toBe(false)
    ready = true
    await controller.recheck()
    expect(controller.state).toEqual({ status: 'idle' })
    expect(controller.available).toBe(true)
  })
})

describe('DisplayController: following the phone', () => {
  it('prepares every size once when a phone pairs', async () => {
    const { controller, calls } = setup()
    await controller.start()
    controller.phoneJoined(phone('a'))
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'display.prepare')).toBe(true))
    const prepare = calls.find((c) => c.method === 'display.prepare')
    expect(prepare?.params).toEqual({ sizes: SIZES })
    await settled(controller, 'idle')
    expect(calls.filter((c) => c.method === 'display.prepare')).toHaveLength(1)
  })

  it('attaches at the requested size, resizes, and detaches on stop', async () => {
    const { controller, methods, attaches, events } = setup()
    await controller.start()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    expect(controller.state).toEqual({
      status: 'attached',
      phoneId: 'a',
      size: { width: 1440, height: 1080 },
    })

    controller.streamRequested('a', { width: 1080, height: 1440 })
    await vi.waitFor(() =>
      expect(controller.state).toMatchObject({ size: { width: 1080, height: 1440 } }),
    )
    expect(attaches()).toEqual(['1440x1080', '1080x1440'])

    controller.streamStopped('a')
    await settled(controller, 'idle')
    expect(methods().at(-1)).toBe('display.detach')
    expect(events).toContain('detached a')
  })

  it('asks for 60 Hz by default', async () => {
    const { controller, calls } = setup()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    const attach = calls.find((c) => c.method === 'display.attach')
    expect(attach?.params).toEqual({ width: 1440, height: 1080, refreshHz: 60 })
  })

  it('does not call the helper again for the size it already has', async () => {
    const { controller, attaches } = setup()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(attaches()).toEqual(['1440x1080'])
  })

  it('removes the monitor when the phone disconnects', async () => {
    const { controller, methods } = setup()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    controller.phoneLeft('a')
    await settled(controller, 'idle')
    expect(methods().at(-1)).toBe('display.detach')
  })

  it('ignores requests from phones that are not paired', async () => {
    const { controller, calls } = setup()
    controller.streamRequested('ghost', { width: 1440, height: 1080 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toEqual([])
  })

  it('applies only the latest size when requests pile up behind a slow call', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    const { controller, attaches } = setup(async ({ method }) => {
      if (method === 'display.attach' && first) {
        first = false
        await gate // the UAC prompt is open
      }
      return undefined
    })
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await vi.waitFor(() => expect(attaches()).toEqual(['1440x1080']))
    controller.streamRequested('a', { width: 1200, height: 1080 })
    controller.streamRequested('a', { width: 1080, height: 1440 })
    controller.streamRequested('a', { width: 1680, height: 1080 })
    release()
    await vi.waitFor(() =>
      expect(controller.state).toMatchObject({ status: 'attached', size: { width: 1680 } }),
    )
    expect(attaches()).toEqual(['1440x1080', '1680x1080'])
  })

  it('shows a working state while the helper is busy', async () => {
    const { controller, states } = setup()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    expect(states).toContainEqual({ status: 'working', size: { width: 1440, height: 1080 } })
  })
})

describe('DisplayController: one monitor, several phones', () => {
  it('hands the monitor to the phone that asked last and tells the first', async () => {
    const { controller, attaches, events } = setup()
    controller.phoneJoined(phone('a'))
    controller.phoneJoined(phone('b'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    controller.streamRequested('b', { width: 1080, height: 1920 })
    await vi.waitFor(() => expect(controller.state).toMatchObject({ phoneId: 'b' }))
    expect(events).toContain('preempted a by b')
    expect(attaches()).toEqual(['1440x1080', '1080x1920'])

    // The first phone stopping no longer matters.
    controller.streamStopped('a')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.state).toMatchObject({ status: 'attached', phoneId: 'b' })
  })

  it('moves ownership without a helper call when the size is the same', async () => {
    const { controller, attaches, events } = setup()
    controller.phoneJoined(phone('a'))
    controller.phoneJoined(phone('b'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    controller.streamRequested('b', { width: 1440, height: 1080 })
    await vi.waitFor(() => expect(controller.state).toMatchObject({ phoneId: 'b' }))
    expect(attaches()).toEqual(['1440x1080'])
    expect(events).toContain('attached b 1440x1080')
  })

  it('keeps the monitor when a phone that does not own it leaves', async () => {
    const { controller, methods } = setup()
    controller.phoneJoined(phone('a'))
    controller.phoneJoined(phone('b'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    controller.phoneLeft('b')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.state.status).toBe('attached')
    expect(methods()).not.toContain('display.detach')
  })
})

describe('DisplayController: failures', () => {
  it('reports a declined UAC prompt for the size and tells the phone', async () => {
    const { controller, events } = setup(({ method }) =>
      method === 'display.attach'
        ? failure('permissionDenied', 'Administrator approval was declined')
        : undefined,
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'problem')
    expect(controller.state).toMatchObject({
      reason: 'permission-denied',
      size: { width: 1440, height: 1080 },
      message: expect.stringContaining('1440×1080'),
    })
    expect(events).toContain('failed a permission-denied')
  })

  it('reports a missing driver found at attach time with the helper’s message', async () => {
    const hint =
      'C:\\VirtualDisplayDriver\\vdd_settings.xml not found. Install Virtual Display Driver: run `winget install ...`'
    const { controller } = setup(({ method }) =>
      method === 'display.attach' ? failure('backendUnavailable', hint) : undefined,
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'problem')
    expect(controller.state).toMatchObject({ reason: 'driver-missing', message: hint })
  })

  it('does not hammer the helper after a failure, but retries on a new request', async () => {
    let allow = false
    const { controller, attaches } = setup(({ method }) =>
      method === 'display.attach' && !allow ? failure('permissionDenied', 'declined') : undefined,
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'problem')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(attaches()).toEqual(['1440x1080'])

    allow = true
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    expect(attaches()).toEqual(['1440x1080', '1440x1080'])
  })

  it('retry() repeats the failed attach', async () => {
    let allow = false
    const { controller, attaches } = setup(({ method }) =>
      method === 'display.attach' && !allow ? failure('permissionDenied', 'declined') : undefined,
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'problem')
    allow = true
    await controller.retry()
    expect(controller.state).toMatchObject({ status: 'attached' })
    expect(attaches()).toHaveLength(2)
  })

  it('retry() runs a declined prepare again', async () => {
    let allow = false
    const { controller, calls } = setup(({ method }) =>
      method === 'display.prepare' && !allow ? failure('permissionDenied', 'declined') : undefined,
    )
    controller.phoneJoined(phone('a'))
    await settled(controller, 'problem')
    expect(controller.state).toMatchObject({ reason: 'permission-denied', size: null })

    allow = true
    await controller.retry()
    expect(controller.state).toEqual({ status: 'idle' })
    expect(calls.filter((c) => c.method === 'display.prepare')).toHaveLength(2)
  })

  it('a declined prepare does not stop a later attach from working', async () => {
    const { controller } = setup(({ method }) =>
      method === 'display.prepare' ? failure('permissionDenied', 'declined') : undefined,
    )
    controller.phoneJoined(phone('a'))
    await settled(controller, 'problem')
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
  })

  it('shows a helper that cannot start', async () => {
    const { HelperUnavailableError } = await import('./helper-host.ts')
    const { controller, host } = setup()
    host.session.mockRejectedValue(
      new HelperUnavailableError('not-found', 'The display helper is not built.'),
    )
    await controller.start()
    expect(controller.state).toMatchObject({ status: 'problem', reason: 'helper-missing' })
  })

  it('treats a helper that exits as a problem and recovers on the next request', async () => {
    const { controller, exit, events } = setup()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')

    exit()
    expect(controller.state).toMatchObject({ status: 'problem', reason: 'helper-failed' })
    expect(events).toContain('detached a')

    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
  })
})

describe('DisplayController: prepare restarts the driver', () => {
  it('puts the wanted size back when preparing added sizes under an attached monitor', async () => {
    let added = 0
    const { controller, attaches } = setup(
      ({ method }) => (method === 'display.prepare' ? { type: 'prepared', added } : undefined),
      scaled,
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')

    added = 2 // a second phone's sizes had to be added, which restarts the driver
    controller.phoneJoined(phone('b', { width: 1024, height: 768 }))
    await vi.waitFor(() => expect(attaches()).toEqual(['1440x1080', '1440x1080']))
    await settled(controller, 'attached')
  })
})

describe('DisplayController: a viewport that changed after pairing', () => {
  // `scaled` turns the 800x360 viewport (at 3x) the phone paired with into 2400x1080.
  const rotated = { viewport: { width: 892, height: 412 }, devicePixelRatio: 3 } // 2676x1236
  const paired = { viewport: { width: 800, height: 360 }, devicePixelRatio: 3 }

  it('prepares the sizes of the viewport a request carries before attaching', async () => {
    const { controller, methods, prepares } = setup(undefined, scaled)
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1680, height: 1080 }, rotated)
    await settled(controller, 'attached')

    // The requested size comes first, then what this viewport can produce; nothing twice.
    expect(prepares()).toEqual([['2400x1080'], ['1680x1080', '2676x1236']])
    expect(methods().filter((m) => m !== 'helper.hello')).toEqual([
      'display.prepare',
      'display.prepare',
      'display.attach',
    ])
  })

  it('leaves out sizes that are already prepared, and skips the prepare when none are left', async () => {
    const { controller, prepares, attaches } = setup(undefined, scaled)
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1680, height: 1080 }, rotated)
    await settled(controller, 'attached')
    expect(prepares()).toHaveLength(2)

    // Back to the viewport it paired with, then to the rotated one again.
    controller.streamRequested('a', { width: 2400, height: 1080 }, paired)
    await vi.waitFor(() => expect(attaches()).toEqual(['1680x1080', '2400x1080']))
    controller.streamRequested('a', { width: 1680, height: 1080 }, rotated)
    await vi.waitFor(() => expect(attaches()).toHaveLength(3))
    expect(prepares()).toHaveLength(2)
  })

  it('prepares only what is new when a rotated viewport shares some sizes with the paired one', async () => {
    const shared = { width: 2400, height: 1080 }
    const { controller, prepares } = setup(undefined, (viewport) =>
      viewport.width === 800 ? [shared] : [shared, { width: 2676, height: 1236 }],
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 2400, height: 1080 }, rotated)
    await settled(controller, 'attached')
    expect(prepares()).toEqual([['2400x1080'], ['2676x1236']])
  })

  it('only attaches when the request carries no viewport', async () => {
    const { controller, prepares, attaches } = setup(undefined, scaled)
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1680, height: 1080 })
    await settled(controller, 'attached')
    expect(prepares()).toEqual([['2400x1080']])
    expect(attaches()).toEqual(['1680x1080'])
  })

  it('does not queue sizes that are already waiting behind a prompt', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { controller, prepares } = setup(async ({ method }) => {
      if (method === 'display.prepare') await gate // the UAC prompt is open
      return undefined
    }, scaled)
    controller.phoneJoined(phone('a'))
    await vi.waitFor(() => expect(prepares()).toHaveLength(1))
    // The phone's first request arrives with the viewport it paired with, as the prompt is open.
    controller.streamRequested('a', { width: 2400, height: 1080 }, paired)
    release()
    await settled(controller, 'attached')
    expect(prepares()).toEqual([['2400x1080']])
  })

  it('prepares the same sizes once when two phones have the same screen', async () => {
    const { controller, prepares } = setup(undefined, scaled)
    controller.phoneJoined(phone('a'))
    controller.phoneJoined(phone('b'))
    await settled(controller, 'idle')
    expect(prepares()).toEqual([['2400x1080']])
  })

  it('prepares again after the driver went missing and came back', async () => {
    let ready = true
    const { controller, prepares } = setup(({ method }) =>
      method === 'helper.hello'
        ? { type: 'hello', ...readyHello({ ready, reason: ready ? undefined : 'missing' }) }
        : undefined,
    )
    controller.phoneJoined(phone('a'))
    await settled(controller, 'idle')
    ready = false
    await controller.recheck()
    ready = true
    await controller.recheck()

    controller.streamRequested('a', { width: 1440, height: 1080 }, paired)
    await settled(controller, 'attached')
    expect(prepares()).toEqual([
      ['1440x1080', '1080x1440'],
      ['1440x1080', '1080x1440'],
    ])
  })

  describe('when Windows asks for approval and the user declines', () => {
    function declining() {
      let allowed = false
      const harness = setup(({ method }) => {
        if (method === 'display.prepare' && !allowed) {
          return failure('permissionDenied', 'Administrator approval was declined')
        }
        return undefined
      }, scaled)
      harness.controller.phoneJoined(phone('a'))
      return {
        ...harness,
        allow: () => {
          allowed = true
        },
      }
    }

    it('tells the phone and does not ask again for the attach that follows', async () => {
      const { controller, attaches, events } = declining()
      controller.streamRequested('a', { width: 1680, height: 1080 }, rotated)
      await settled(controller, 'problem')
      await new Promise((resolve) => setTimeout(resolve, 30))

      expect(events).toContain('failed a permission-denied')
      expect(attaches()).toEqual([])
    })

    it('goes ahead with the attach when the size it needs was prepared earlier', async () => {
      let deny = false
      const { controller, attaches } = setup(({ method }) => {
        if (method === 'display.prepare' && deny) {
          return failure('permissionDenied', 'Administrator approval was declined')
        }
        return undefined
      }, scaled)
      controller.phoneJoined(phone('a'))
      await settled(controller, 'idle')

      deny = true
      // Not in the paired list, so this viewport needs a prepare, which is declined; the size
      // asked for is already known to the driver, so the attach still goes through.
      controller.streamRequested('a', { width: 2400, height: 1080 }, rotated)
      await settled(controller, 'attached')
      expect(attaches()).toEqual(['2400x1080'])
    })

    it('"Try again" prepares and then attaches', async () => {
      const { controller, attaches, prepares, allow } = declining()
      controller.streamRequested('a', { width: 1680, height: 1080 }, rotated)
      await settled(controller, 'problem')

      allow()
      await controller.retry()
      expect(controller.state).toMatchObject({ status: 'attached', size: { width: 1680 } })
      expect(attaches()).toEqual(['1680x1080'])
      // The pairing prepare failed first, then the rotated one, and both ran again.
      expect(prepares().length).toBeGreaterThanOrEqual(3)
    })
  })
})

describe('DisplayController: the prompt budget on a real phone', () => {
  /**
   * A driver that keeps a list of sizes: adding any is one UAC prompt, whether `display.prepare`
   * or `display.attach` does it.
   */
  function fakeDriver() {
    const listed = new Set<string>()
    let prompts = 0
    const responder: Responder = ({ method, params }) => {
      if (method === 'display.prepare') {
        const { sizes } = params as { sizes: MonitorSize[] }
        const missing = sizes.filter((s) => !listed.has(`${s.width}x${s.height}`))
        if (missing.length > 0) prompts += 1
        for (const s of missing) listed.add(`${s.width}x${s.height}`)
        return { type: 'prepared', added: missing.length }
      }
      if (method === 'display.attach') {
        const { width, height } = params as MonitorSize
        if (!listed.has(`${width}x${height}`)) {
          prompts += 1
          listed.add(`${width}x${height}`)
        }
      }
      return undefined
    }
    return { responder, prompts: () => prompts }
  }

  const DPR = 2.625
  type Viewport = { width: number; height: number }

  function phoneOn(driver: ReturnType<typeof fakeDriver>, paired: Viewport) {
    const { controller } = setup(driver.responder, sizesForPhone)
    controller.phoneJoined({ id: 'a', viewport: paired, devicePixelRatio: DPR })
    const split = (viewport: Viewport, preset: SplitPreset) => {
      const { stream } = computeSplit({
        viewport,
        devicePixelRatio: DPR,
        monitorFraction: SPLIT_PRESETS[preset],
      })
      if (!stream) throw new Error('the preset has no monitor')
      return stream
    }
    /** What the phone does after a split or rotation: request, and wait for the monitor. */
    const choose = async (viewport: Viewport, preset: SplitPreset) => {
      const size = split(viewport, preset)
      controller.streamRequested('a', size, { viewport, devicePixelRatio: DPR })
      await vi.waitFor(() =>
        expect(controller.state).toEqual({ status: 'attached', phoneId: 'a', size }),
      )
    }
    return { choose, split }
  }

  it('costs one prompt at pairing and one more after the first rotation, not one per preset', async () => {
    const driver = fakeDriver()
    const portrait = { width: 412, height: 800 }
    // What Chrome reports once the phone is sideways: the toolbar leaves 892x412, not the
    // 800x412 that turning the paired viewport would give.
    const landscape = { width: 892, height: 412 }
    const { choose, split } = phoneOn(driver, portrait)

    // The premise: the swapped guess does not contain the landscape size, so it needs a prompt.
    expect(sizesForPhone(portrait, DPR)).not.toContainEqual(split(landscape, '70-30'))

    await choose(portrait, '70-30')
    await choose(portrait, '50-50')
    await choose(portrait, 'monitor')
    expect(driver.prompts()).toBe(1)

    await choose(landscape, '70-30')
    expect(driver.prompts()).toBe(2)
    await choose(landscape, '50-50')
    await choose(landscape, 'monitor')
    expect(driver.prompts()).toBe(2)

    // Rotating back and forth afterwards is free: both viewports are in the driver already.
    await choose(portrait, '70-30')
    await choose(landscape, '50-50')
    await choose(portrait, 'monitor')
    expect(driver.prompts()).toBe(2)
  })

  it('costs nothing extra when the rotated viewport is exactly the swapped one', async () => {
    const driver = fakeDriver()
    const { choose } = phoneOn(driver, { width: 768, height: 1024 })

    await choose({ width: 768, height: 1024 }, '70-30')
    await choose({ width: 1024, height: 768 }, '70-30')
    await choose({ width: 1024, height: 768 }, 'monitor')
    expect(driver.prompts()).toBe(1)
  })
})

describe('DisplayController: shutdown', () => {
  it('detaches and stops the helper', async () => {
    const { controller, host, methods } = setup()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await settled(controller, 'attached')
    await controller.stop()
    expect(methods().at(-1)).toBe('display.detach')
    expect(host.stop).toHaveBeenCalledTimes(1)
  })

  it('still closes the helper when a call is stuck', async () => {
    const stuck = new Promise<never>(() => {})
    const { controller, host } = setup(({ method }) =>
      method === 'display.attach' ? stuck : undefined,
    )
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await vi.waitFor(() => expect(controller.state.status).toBe('working'))
    await controller.stop()
    expect(host.stop).toHaveBeenCalledTimes(1)
  })

  it('ignores requests after stopping', async () => {
    const { controller, calls } = setup()
    await controller.stop()
    controller.phoneJoined(phone('a'))
    controller.streamRequested('a', { width: 1440, height: 1080 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toEqual([])
  })
})
