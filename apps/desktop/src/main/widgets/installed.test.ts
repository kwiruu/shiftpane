import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PcMessage } from '@shiftpane/protocol'
import type { RunInput, RunResult } from '@shiftpane/widget-runtime'
import type { ActionName } from '@shiftpane/widget-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhoneInfo } from '../server/phone-hub.ts'
import { fileStorage } from '../storage.ts'
import { InstalledWidgets, refreshSeconds } from './installed.ts'
import { type Cipher, WidgetSecrets } from './secrets.ts'
import type { SourceReader } from './sources.ts'
import { InstalledStore } from './store.ts'

const gpuRing = {
  manifest: {
    id: 'gpu-ring',
    name: 'GPU ring',
    description: 'GPU load as a ring.',
    version: '1.1.0',
    author: 'shiftpane',
    license: 'MIT',
    categories: ['system'],
    minAppVersion: '0.5.0',
    sizes: ['small'],
    permissions: { sources: ['gpu'] },
  },
  view: { small: { type: 'ring', bind: '@gpu/percent' } },
  sample: {},
}

const stars = {
  manifest: {
    id: 'github-stars',
    name: 'GitHub stars',
    description: 'Stars across your repositories.',
    version: '1.1.1',
    author: 'shiftpane',
    license: 'MIT',
    categories: ['dev'],
    minAppVersion: '0.5.0',
    sizes: ['small'],
    refreshSeconds: 900,
    permissions: { network: ['api.github.com'], secrets: ['GITHUB_TOKEN'] },
    config: [{ key: 'owner', label: 'User or organization', type: 'string', required: true }],
  },
  view: { small: { type: 'value', bind: '/total' } },
  sample: { total: 2481 },
  collector: 'export default async () => ({ total: 1 })',
}

type Fixture = typeof gpuRing & { collector?: string }

const phone = (id: string): PhoneInfo => ({
  id,
  deviceId: `device-${id}`,
  name: id,
  address: '192.168.1.4',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  connectedAt: 0,
  screen: null,
})

/** Base64 "encryption", so tests can see what was stored. */
const cipher: Cipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(`sealed:${text}`),
  decrypt: (data) => data.toString().replace(/^sealed:/, ''),
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shiftpane-widgets-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function folder(name: string, widget: Fixture | typeof stars, extra: object = {}) {
  const path = join(root, 'src', name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ ...widget.manifest, ...extra }))
  await writeFile(join(path, 'view.json'), JSON.stringify(widget.view))
  await writeFile(join(path, 'sample.json'), JSON.stringify(widget.sample))
  if ('collector' in widget && widget.collector) {
    await writeFile(join(path, 'collector.js'), widget.collector)
  }
  return path
}

function setup(
  options: {
    run?: (input: RunInput) => Promise<RunResult>
    now?: () => number
    press?: (action: ActionName, value?: number) => Promise<void>
  } = {},
) {
  const sent: Array<{ id: string; message: PcMessage }> = []
  const listeners = new Map<string, (phones: PhoneInfo[]) => void>()
  let phones: PhoneInfo[] = []
  const hub = {
    on: (event: string, listener: (phones: PhoneInfo[]) => void) => listeners.set(event, listener),
    off: () => {},
    send: (id: string, message: PcMessage) => {
      sent.push({ id, message })
      return true
    },
    get phones() {
      return phones
    },
  }
  const sources = {
    read: vi.fn(async (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, { percent: 40, history: [1, 2] }])),
    ),
  }
  const store = new InstalledStore(join(root, 'installed'))
  const secrets = new WidgetSecrets(fileStorage(join(root, 'secrets.json')), cipher)
  const run = vi.fn(options.run ?? (async () => ({ ok: true, output: { total: 7 } }) as RunResult))
  const widgets = new InstalledWidgets({
    store,
    secrets,
    sources: sources as unknown as SourceReader,
    hub: hub as never,
    appVersion: '0.5.0',
    run,
    now: options.now,
    press: options.press,
  })
  const connect = (...ids: string[]) => {
    phones = ids.map(phone)
    listeners.get('change')?.(phones)
  }
  return { widgets, store, secrets, sent, sources, run, connect }
}

async function install(t: ReturnType<typeof setup>, path: string) {
  const check = await t.widgets.check(path)
  if (check.status !== 'ready') throw new Error(JSON.stringify(check))
  const result = await t.widgets.install(check.token)
  if (!result.ok) throw new Error(result.problem)
  return check
}

describe('checking a folder', () => {
  it('says what the widget may do before anything is installed', async () => {
    const t = setup()
    await t.widgets.start()
    const check = await t.widgets.check(await folder('stars', stars))
    expect(check).toMatchObject({
      status: 'ready',
      widget: { id: 'github-stars', name: 'GitHub stars', hasCollector: true },
      sendsOffPc: false,
      replaces: null,
    })
    if (check.status === 'ready') {
      expect(check.permissions.map((line) => line.text)).toEqual([
        'Can reach api.github.com',
        'Needs your GITHUB_TOKEN',
      ])
    }
    expect(t.widgets.list()).toEqual([])
  })

  it('refuses a built-in id, a newer app and a broken package', async () => {
    const t = setup()
    await t.widgets.start()
    const builtIn = await t.widgets.check(await folder('a', gpuRing, { id: 'pc-stats' }))
    expect(builtIn).toMatchObject({ status: 'invalid' })
    const newer = await t.widgets.check(await folder('b', gpuRing, { minAppVersion: '9.0.0' }))
    expect(newer).toMatchObject({
      status: 'invalid',
      problems: ['It needs ShiftPane 9.0.0 or later; this is 0.5.0.'],
    })
    const empty = join(root, 'empty')
    await mkdir(empty)
    const nothing = await t.widgets.check(empty)
    expect(nothing).toMatchObject({ status: 'invalid' })
  })

  it("lists what a newer version adds to one that's installed", async () => {
    const t = setup()
    await t.widgets.start()
    await install(t, await folder('ring', gpuRing))
    const next = await t.widgets.check(
      await folder('ring-2', gpuRing, {
        version: '1.2.0',
        permissions: { sources: ['gpu', 'cpu'] },
      }),
    )
    expect(next).toMatchObject({ status: 'ready', replaces: { version: '1.1.0' } })
    if (next.status === 'ready') {
      expect(next.replaces?.added.map((line) => line.value)).toEqual(['cpu'])
    }
  })

  it('installs a checked folder only once', async () => {
    const t = setup()
    await t.widgets.start()
    const check = await t.widgets.check(await folder('ring', gpuRing))
    if (check.status !== 'ready') throw new Error('not ready')
    expect(await t.widgets.install(check.token)).toEqual({ ok: true, id: 'gpu-ring' })
    expect((await t.widgets.install(check.token)).ok).toBe(false)
  })
})

describe('installed widgets', () => {
  it('tell connected phones and phones that connect later what they look like', async () => {
    const t = setup()
    await t.widgets.start()
    t.connect('a')
    await install(t, await folder('ring', gpuRing))
    t.connect('a', 'b')
    await vi.waitFor(() => expect(t.sent.filter(({ id }) => id === 'b')).toHaveLength(1))
    const last = t.sent.at(-1)?.message
    expect(last).toEqual({
      type: 'widgets.installed',
      widgets: [
        {
          id: 'gpu-ring',
          name: 'GPU ring',
          version: '1.1.0',
          sizes: ['small'],
          actions: [],
          view: gpuRing.view,
        },
      ],
    })
  })

  it('send a bindings-only widget its sources, with nothing to run', async () => {
    const t = setup()
    await t.widgets.start()
    await install(t, await folder('ring', gpuRing))
    const data = await t.widgets.collectors()['gpu-ring']?.collect()
    expect(data).toEqual({
      sources: { gpu: { percent: 40, history: [1, 2] } },
      output: {},
      config: {},
      problem: null,
    })
    expect(t.sources.read).toHaveBeenCalledWith(['gpu'])
    expect(t.run).not.toHaveBeenCalled()
  })

  it('ask for required config before running a collector', async () => {
    const t = setup()
    await t.widgets.start()
    await install(t, await folder('stars', stars))
    const data = await t.widgets.collectors()['github-stars']?.collect()
    expect(data).toMatchObject({
      output: null,
      problem: 'Set "User or organization" for this widget in ShiftPane on your PC.',
    })
    expect(t.run).not.toHaveBeenCalled()
  })

  it('run a collector with its config and only its own secrets, then wait for its refresh', async () => {
    let now = 1_000_000
    const t = setup({ now: () => now })
    await t.widgets.start()
    await install(t, await folder('stars', stars))
    expect(await t.widgets.setConfig('github-stars', { owner: 'kwiruu', stray: 1 })).toEqual([])
    expect(await t.widgets.setSecret('github-stars', 'GITHUB_TOKEN', 'ghp_test')).toBeNull()
    expect(await t.widgets.setSecret('github-stars', 'OTHER', 'x')).toMatch(/doesn't use OTHER/)

    const collector = t.widgets.collectors()['github-stars']
    expect(await collector?.collect()).toMatchObject({
      output: { total: 7 },
      config: { owner: 'kwiruu' },
      problem: null,
    })
    expect(t.run).toHaveBeenCalledTimes(1)
    expect(t.run.mock.calls[0]?.[0]).toMatchObject({
      config: { owner: 'kwiruu' },
      secrets: { GITHUB_TOKEN: 'ghp_test' },
    })

    now += 60_000
    await collector?.collect()
    expect(t.run).toHaveBeenCalledTimes(1)
    now += 900_000
    await collector?.collect()
    await vi.waitFor(() => expect(t.run).toHaveBeenCalledTimes(2))
  })

  it("keep a collector's last output when a later run fails", async () => {
    let now = 0
    let fail = false
    const t = setup({
      now: () => now,
      run: async () =>
        fail ? { ok: false, error: 'GitHub answered 403' } : { ok: true, output: { total: 3 } },
    })
    await t.widgets.start()
    await install(t, await folder('stars', stars))
    await t.widgets.setConfig('github-stars', { owner: 'kwiruu' })
    const collector = t.widgets.collectors()['github-stars']
    await collector?.collect()
    fail = true
    now += 1_000_000
    await collector?.collect()
    await vi.waitFor(() =>
      expect(t.widgets.list()[0]?.status.problem).toBe("Couldn't update: GitHub answered 403"),
    )
    expect(await collector?.collect()).toMatchObject({ output: { total: 3 }, problem: null })
  })

  it('refuse config that does not fit the field, and keep the collector until config changes', async () => {
    const t = setup()
    await t.widgets.start()
    await install(t, await folder('stars', stars))
    const before = t.widgets.collectors()['github-stars']
    expect(await t.widgets.setConfig('github-stars', { owner: 42 })).toEqual([
      'User or organization has to be text.',
    ])
    expect(t.widgets.collectors()['github-stars']).toBe(before)
    await t.widgets.setConfig('github-stars', { owner: 'kwiruu' })
    expect(t.widgets.collectors()['github-stars']).not.toBe(before)
  })

  it('are kept with their config across restarts, and forget their secrets when removed', async () => {
    const first = setup()
    await first.widgets.start()
    await install(first, await folder('stars', stars))
    await first.widgets.setConfig('github-stars', { owner: 'kwiruu' })
    await first.widgets.setSecret('github-stars', 'GITHUB_TOKEN', 'ghp_test')

    const second = setup()
    await second.widgets.start()
    expect(second.widgets.list()).toMatchObject([
      {
        id: 'github-stars',
        config: { values: { owner: 'kwiruu' } },
        secrets: [{ name: 'GITHUB_TOKEN', set: true }],
      },
    ])
    await second.widgets.remove('github-stars')
    expect(second.widgets.list()).toEqual([])
    expect(second.secrets.names('github-stars')).toEqual([])
  })
})

describe('refreshSeconds', () => {
  it('follows the manifest, but runs a collector that reaches hosts at most every 30 s', () => {
    const entry = (refresh: number | undefined, network: string[]) => ({
      widget: {
        manifest: {
          refreshSeconds: refresh,
          permissions: { sources: [], actions: [], local: [], network, secrets: [] },
        },
      },
    })
    expect(refreshSeconds(entry(900, ['api.github.com']) as never)).toBe(900)
    expect(refreshSeconds(entry(1, ['api.github.com']) as never)).toBe(30)
    expect(refreshSeconds(entry(5, []) as never)).toBe(5)
    expect(refreshSeconds(entry(undefined, []) as never)).toBe(60)
  })
})

describe('buttons', () => {
  it('press only an action the widget declares, and a volume only with a value', async () => {
    const press = vi.fn(async (_action: ActionName, _value?: number) => {})
    const t = setup({ press })
    await t.widgets.start()
    const pressed = vi.fn()
    t.widgets.on('pressed', pressed)
    await install(
      t,
      await folder('knob', gpuRing, {
        id: 'volume-knob',
        permissions: { sources: ['gpu'], actions: ['audio.toggle-mute', 'audio.set-volume'] },
      }),
    )
    expect(await t.widgets.press('volume-knob', 'audio.toggle-mute')).toBe(true)
    expect(await t.widgets.press('volume-knob', 'media.next')).toBe(false)
    expect(await t.widgets.press('volume-knob', 'audio.set-volume')).toBe(false)
    expect(await t.widgets.press('volume-knob', 'audio.set-volume', 30)).toBe(true)
    expect(await t.widgets.press('not-installed', 'audio.toggle-mute')).toBe(false)
    expect(press.mock.calls).toEqual([
      ['audio.toggle-mute', undefined],
      ['audio.set-volume', 30],
    ])
    expect(pressed).toHaveBeenCalledWith('volume-knob')
  })
})
