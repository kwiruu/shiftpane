import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packPackage, sha256 } from '@shiftpane/widget-runtime'
import type { IndexVersion } from '@shiftpane/widget-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Get, Registry } from './registry.ts'

const BASE = 'https://registry.test'

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

const zip = packPackage({ 'manifest.json': '{}' })
const version: IndexVersion = {
  sha256: sha256(zip),
  size: zip.byteLength,
  url: `${BASE}/packages/${sha256(zip)}.zip`,
  minAppVersion: '0.5.0',
  permissions: { sources: ['gpu'], actions: [], local: [], network: [], secrets: [] },
}
const index = {
  format: 1,
  generatedAt: '2026-10-22T00:00:00Z',
  widgets: [
    {
      id: 'gpu-ring',
      name: 'GPU ring',
      summary: 'GPU load as a ring.',
      author: { login: 'shiftpane' },
      categories: ['system'],
      latest: '1.1.0',
      versions: { '1.1.0': version },
    },
  ],
}

let dir: string
const signer = keyPair()

/** A registry server: each file as bytes, signed by `key` unless given its own signature. */
function serve(files: Record<string, string | Uint8Array>, key = signer.privateKey) {
  const served = new Map<string, Uint8Array>()
  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    served.set(`${BASE}/${name}`, bytes)
    if (name.endsWith('.json')) {
      served.set(
        `${BASE}/${name}.sig`,
        new TextEncoder().encode(sign(null, bytes, key).toString('base64')),
      )
    }
  }
  const get = vi.fn<Get>(async (url) => {
    const bytes = served.get(url)
    if (!bytes) throw new Error(`404 ${url}`)
    return bytes
  })
  return { get, served }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shiftpane-registry-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const registry = (get: Get, publicKeys = [signer.publicKey]) =>
  new Registry({ dir, base: BASE, publicKeys, get })

describe('Registry', () => {
  it('reads an index signed by a key it ships', async () => {
    const { get } = serve({ 'index.json': JSON.stringify(index) })
    expect((await registry(get).index()).widgets[0]?.id).toBe('gpu-ring')
  })

  it('refuses an index someone changed, or signed with another key', async () => {
    const { get, served } = serve({ 'index.json': JSON.stringify(index) })
    served.set(
      `${BASE}/index.json`,
      new TextEncoder().encode(JSON.stringify({ ...index, widgets: [] })),
    )
    await expect(registry(get).index()).rejects.toThrow(/isn't signed by ShiftPane/)
    const other = keyPair()
    const { get: forged } = serve({ 'index.json': JSON.stringify(index) }, other.privateKey)
    await expect(registry(forged).index()).rejects.toThrow(/isn't signed by ShiftPane/)
  })

  it('uses the index it verified last when the marketplace is out of reach', async () => {
    const { get } = serve({
      'index.json': JSON.stringify(index),
      'revoked.json': '{"format":1,"generatedAt":"x","versions":[]}',
    })
    await registry(get).index()
    await registry(get).revoked()
    const offline: Get = async () => {
      throw new Error('offline')
    }
    expect((await registry(offline).index()).widgets).toHaveLength(1)
    expect((await registry(offline).revoked()).versions).toEqual([])
  })

  it('takes a package only with the hash and size the index signed for, and keeps it', async () => {
    const { get, served } = serve({ 'index.json': JSON.stringify(index) })
    served.set(version.url, zip)
    expect(await registry(get).package(version)).toEqual(zip)
    // The kept copy is used from then on.
    get.mockClear()
    expect(await registry(get).package(version)).toEqual(zip)
    expect(get).not.toHaveBeenCalled()

    const other = packPackage({ 'manifest.json': '{"evil":true}' })
    served.set(`${BASE}/packages/other.zip`, other)
    await expect(
      registry(get).package({
        ...version,
        sha256: sha256(zip).replace(/^./, '0'),
        url: `${BASE}/packages/other.zip`,
      }),
    ).rejects.toThrow(/isn't the one the marketplace signed for/)
  })

  it('downloads packages over https only', async () => {
    const { get } = serve({})
    await expect(
      registry(get).package({
        ...version,
        sha256: '1'.repeat(64),
        url: 'http://registry.test/p.zip',
      }),
    ).rejects.toThrow(/https/)
  })
})
