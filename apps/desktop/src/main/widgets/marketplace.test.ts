import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packPackage, sha256 } from '@shiftpane/widget-runtime'
import type { IndexVersion, Permissions, RegistryIndex, RevokedList } from '@shiftpane/widget-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileStorage } from '../storage.ts'
import { InstalledWidgets } from './installed.ts'
import { Marketplace } from './marketplace.ts'
import type { Registry } from './registry.ts'
import { type Cipher, WidgetSecrets } from './secrets.ts'
import type { SourceReader } from './sources.ts'
import { InstalledStore } from './store.ts'

const cipher: Cipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(text),
  decrypt: (data) => data.toString(),
}

const permissions: Permissions = {
  sources: ['gpu'],
  actions: [],
  local: [],
  network: [],
  secrets: [],
}

function ring(version: string, extra: object = {}) {
  const manifest = {
    id: 'gpu-ring',
    name: 'GPU ring',
    description: 'GPU load as a ring.',
    version,
    author: 'shiftpane',
    license: 'MIT',
    categories: ['system'],
    minAppVersion: '0.5.0',
    sizes: ['small'],
    permissions: { sources: ['gpu'] },
    ...extra,
  }
  const zip = packPackage({
    'manifest.json': JSON.stringify(manifest),
    'view.json': JSON.stringify({ small: { type: 'ring', bind: '@gpu/percent' } }),
    'sample.json': '{}',
    'README.md': '# GPU ring',
    LICENSE: 'MIT',
  })
  const details: IndexVersion = {
    sha256: sha256(zip),
    size: zip.byteLength,
    url: `https://registry.test/packages/${sha256(zip)}.zip`,
    minAppVersion: '0.5.0',
    permissions,
  }
  return { zip, details }
}

let root: string
let index: RegistryIndex
let revoked: RevokedList
const packages = new Map<string, Uint8Array>()

function fakeRegistry(): Registry {
  return {
    index: vi.fn(async () => index),
    revoked: vi.fn(async () => revoked),
    package: vi.fn(async (details: IndexVersion) => {
      const zip = packages.get(details.sha256)
      if (!zip) throw new Error('404')
      return zip
    }),
    get knownIndex() {
      return index
    },
  } as unknown as Registry
}

function publish(...versions: { version: string; extra?: object; listed?: typeof permissions }[]) {
  const entries: Record<string, IndexVersion> = {}
  for (const { version, extra, listed } of versions) {
    const { zip, details } = ring(version, extra)
    packages.set(details.sha256, zip)
    entries[version] = { ...details, permissions: listed ?? permissions } as IndexVersion
  }
  index = {
    format: 1,
    generatedAt: 'now',
    widgets: [
      {
        id: 'gpu-ring',
        name: 'GPU ring',
        summary: 'GPU load as a ring.',
        author: { login: 'shiftpane' },
        categories: ['system'],
        latest: versions.at(-1)?.version ?? '',
        versions: entries,
      },
    ],
  }
}

function setup(appVersion = '0.5.0') {
  const installed = new InstalledWidgets({
    store: new InstalledStore(join(root, 'installed')),
    secrets: new WidgetSecrets(fileStorage(join(root, 'secrets.json')), cipher),
    sources: { read: async () => ({}) } as unknown as SourceReader,
    hub: { on: () => {}, off: () => {}, send: () => true, phones: [] } as never,
    appVersion,
  })
  const marketplace = new Marketplace({ registry: fakeRegistry(), installed, appVersion })
  return { installed, marketplace }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shiftpane-market-'))
  revoked = { format: 1, generatedAt: 'now', versions: [] }
  packages.clear()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Marketplace', () => {
  it('lists widgets with a preview from their verified package', async () => {
    publish({ version: '1.1.0' })
    const { installed, marketplace } = setup()
    await installed.start()
    const list = await marketplace.list()
    expect(list).toMatchObject({
      ok: true,
      widgets: [
        {
          id: 'gpu-ring',
          version: '1.1.0',
          installed: null,
          builtIn: false,
          preview: { sizes: ['small'], sources: ['gpu'] },
        },
      ],
    })
  })

  it('installs a version after the same prompt as a folder, and remembers where it came from', async () => {
    publish({ version: '1.1.0' })
    const { installed, marketplace } = setup()
    await installed.start()
    const check = await marketplace.check('gpu-ring')
    expect(check).toMatchObject({
      status: 'ready',
      from: 'marketplace',
      widget: { version: '1.1.0' },
    })
    if (check.status !== 'ready') throw new Error('not ready')
    expect(await installed.install(check.token)).toEqual({ ok: true, id: 'gpu-ring' })
    expect(installed.list()[0]?.origin).toMatchObject({ kind: 'marketplace', version: '1.1.0' })
  })

  it('refuses a package that asks for more than the signed index lists', async () => {
    publish({
      version: '1.1.0',
      extra: { permissions: { sources: ['gpu'], network: ['evil.example.com'] } },
    })
    const { installed, marketplace } = setup()
    await installed.start()
    expect(await marketplace.check('gpu-ring')).toMatchObject({
      status: 'invalid',
      problems: ['The package asks for other permissions than the marketplace lists.'],
    })
  })

  it('stops a withdrawn version and offers a newer one', async () => {
    publish({ version: '1.1.0' })
    const { installed, marketplace } = setup()
    await installed.start()
    const check = await marketplace.check('gpu-ring')
    if (check.status !== 'ready') throw new Error('not ready')
    await installed.install(check.token)

    revoked = {
      format: 1,
      generatedAt: 'now',
      versions: [{ id: 'gpu-ring', version: '1.1.0', reason: 'It leaked data', yankedAt: 'now' }],
    }
    publish({ version: '1.1.0' }, { version: '1.2.0' })
    await marketplace.refresh()
    expect(installed.list()[0]).toMatchObject({ revoked: 'It leaked data', update: '1.2.0' })
    const data = await installed.collectors()['gpu-ring']?.collect()
    expect(data).toMatchObject({
      output: null,
      problem: 'Withdrawn from the marketplace: It leaked data',
    })
  })

  it('says when every version needs a newer app, and never offers a built-in id', async () => {
    publish({ version: '2.0.0' })
    const entry = index.widgets[0]
    if (!entry) throw new Error('no entry')
    const first = entry.versions['2.0.0']
    if (first) entry.versions['2.0.0'] = { ...first, minAppVersion: '9.0.0' }
    const { installed, marketplace } = setup()
    await installed.start()
    const list = await marketplace.list()
    expect(list).toMatchObject({ ok: true, widgets: [{ version: null, needsApp: '9.0.0' }] })
    expect(await marketplace.check('gpu-ring')).toMatchObject({
      status: 'invalid',
      problems: ['It needs ShiftPane 9.0.0 or later; this is 0.5.0.'],
    })
  })
})
