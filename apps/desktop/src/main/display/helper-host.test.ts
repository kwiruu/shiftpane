import type { HelloInfo } from '@shiftpane/helper-client'
import { describe, expect, it, vi } from 'vitest'
import {
  type HelperChannel,
  HelperHost,
  HelperUnavailableError,
  type OpenedHelper,
  type OpenHooks,
} from './helper-host.ts'

const hello = (protocolVersion = 2): HelloInfo => ({
  protocolVersion,
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
  },
})

/** A helper process the test controls: answer hello or not, exit when told. */
function fakeProcess(options: { hello?: HelloInfo | Error } = {}) {
  let exit: () => void = () => {}
  const closed = new Promise<void>((resolve) => {
    exit = resolve
  })
  const kill = vi.fn(() => exit())
  const close = vi.fn()
  const answer = options.hello ?? hello()
  const channel = {
    call: vi.fn(async () => {
      if (answer instanceof Error) throw answer
      return { type: 'hello', ...answer }
    }),
    close,
  } as unknown as HelperChannel
  const opened: OpenedHelper = { channel, closed, kill }
  return { opened, exit: () => exit(), kill, close }
}

function makeHost(
  processes: Array<ReturnType<typeof fakeProcess>>,
  extra: { locate?: () => ReturnType<ConstructorParameters<typeof HelperHost>[0]['locate']> } = {},
) {
  const opens: string[] = []
  const hooks: OpenHooks[] = []
  let next = 0
  const host = new HelperHost({
    expectedProtocol: 2,
    stopTimeoutMs: 30,
    locate: extra.locate ?? (() => ({ path: '/bin/shiftpane-helper', searched: [] })),
    open: (path, hook) => {
      opens.push(path)
      hooks.push(hook)
      const process = processes[next++]
      if (!process) throw new Error('no more fake processes')
      return process.opened
    },
  })
  return { host, opens, hooks }
}

describe('HelperHost', () => {
  it('starts the helper once and shares the session', async () => {
    const { host, opens } = makeHost([fakeProcess()])
    const [a, b] = await Promise.all([host.session(), host.session()])
    expect(a).toBe(b)
    expect(a.hello.protocolVersion).toBe(2)
    expect(opens).toEqual(['/bin/shiftpane-helper'])
  })

  it('fails with not-found when there is no executable, without spawning', async () => {
    const { host, opens } = makeHost([], {
      locate: () => ({ path: null, searched: [], message: 'not built' }),
    })
    await expect(host.session()).rejects.toMatchObject({
      name: 'HelperUnavailableError',
      reason: 'not-found',
      message: 'not built',
    })
    expect(opens).toEqual([])
  })

  it('refuses a helper with another protocol version and ends it', async () => {
    const stale = fakeProcess({ hello: hello(1) })
    const { host } = makeHost([stale])
    await expect(host.session()).rejects.toMatchObject({ reason: 'outdated' })
    expect(stale.kill).toHaveBeenCalled()
  })

  it('reports a process that could not start', async () => {
    const broken = fakeProcess({ hello: new Error('helper exited before answering request 1') })
    const { host, hooks } = makeHost([broken])
    const pending = host.session()
    hooks[0]?.onError(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))
    await expect(pending).rejects.toMatchObject({ reason: 'start-failed' })
    await expect(pending).rejects.toThrow(/EACCES/)
  })

  it('reports a helper that does not answer', async () => {
    const mute = fakeProcess({ hello: new Error('helper did not answer helper.hello') })
    const { host } = makeHost([mute])
    await expect(host.session()).rejects.toMatchObject({ reason: 'no-reply' })
  })

  it('can try again after a failed start', async () => {
    const first = fakeProcess({ hello: new Error('nope') })
    const second = fakeProcess()
    const { host, opens } = makeHost([first, second])
    await expect(host.session()).rejects.toBeInstanceOf(HelperUnavailableError)
    await expect(host.session()).resolves.toMatchObject({ hello: { protocolVersion: 2 } })
    expect(opens).toHaveLength(2)
  })

  it('announces an exit and starts a new helper for the next caller', async () => {
    const first = fakeProcess()
    const second = fakeProcess()
    const { host, opens } = makeHost([first, second])
    const exits = vi.fn()
    host.on('exit', exits)
    const before = await host.session()
    first.exit()
    await vi.waitFor(() => expect(exits).toHaveBeenCalledTimes(1))
    const after = await host.session()
    expect(after).not.toBe(before)
    expect(opens).toHaveLength(2)
  })

  it('does not call a refused helper’s exit an exit', async () => {
    const stale = fakeProcess({ hello: hello(9) })
    const { host } = makeHost([stale])
    const exits = vi.fn()
    host.on('exit', exits)
    await expect(host.session()).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(exits).not.toHaveBeenCalled()
  })

  it('closes stdin on stop and waits for the process', async () => {
    const proc = fakeProcess()
    const { host } = makeHost([proc])
    await host.session()
    const stopping = host.stop()
    expect(proc.close).toHaveBeenCalledTimes(1)
    proc.exit()
    await stopping
    expect(proc.kill).not.toHaveBeenCalled()
  })

  it('kills a helper that ignores the closed stdin', async () => {
    const proc = fakeProcess()
    // Exits only when killed.
    const { host } = makeHost([proc])
    await host.session()
    await host.stop()
    expect(proc.kill).toHaveBeenCalledTimes(1)
  })

  it('refuses new sessions once stopped', async () => {
    const { host, opens } = makeHost([fakeProcess()])
    await host.stop()
    await expect(host.session()).rejects.toMatchObject({ reason: 'stopped' })
    expect(opens).toEqual([])
  })
})
