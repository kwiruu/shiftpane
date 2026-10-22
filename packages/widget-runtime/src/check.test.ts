import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkFolder, packFolder } from './check.ts'
import { openPackage } from './zip.ts'

const manifest = {
  id: 'repo-stars',
  name: 'Repo stars',
  description: 'Stars on one repository.',
  version: '1.0.0',
  author: 'octocat',
  license: 'MIT',
  categories: ['dev'],
  minAppVersion: '0.5.0',
  sizes: ['small'],
  refreshSeconds: 600,
  permissions: { network: ['api.github.com'], secrets: ['GITHUB_TOKEN'] },
  config: [
    { key: 'repo', label: 'Repository', type: 'string', required: true },
    { key: 'top', label: 'Top', type: 'number', default: 3, min: 1, max: 10 },
  ],
}

const collector = `import { defineCollector } from '@shiftpane/widget-sdk'
export default defineCollector(async ({ config, secrets, fetch }) => {
  const answer = await fetch('https://api.github.com/repos/' + config.repo)
  const repo = await answer.json()
  return { stars: repo.stargazers_count, token: Boolean(secrets.GITHUB_TOKEN) }
})`

let folder: string

async function write(files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(folder, name, '..'), { recursive: true })
    await writeFile(join(folder, name), text)
  }
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'shiftpane-cli-'))
  await write({
    'manifest.json': JSON.stringify(manifest),
    'view.json': JSON.stringify({ small: { type: 'value', bind: '/stars', format: 'compact' } }),
    'sample.json': JSON.stringify({ stars: 1200 }),
    'collector.js': collector,
    'README.md': '# Repo stars',
    LICENSE: 'MIT License',
  })
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('checkFolder', () => {
  it('passes a widget the marketplace would take', async () => {
    const report = await checkFolder(folder)
    expect(report.problems).toEqual([])
    expect(report.widget?.manifest.id).toBe('repo-stars')
  })

  it('finds what the marketplace would refuse', async () => {
    await write({
      'manifest.json': JSON.stringify({ ...manifest, id: 'pc-stats', license: 'Proprietary' }),
      'collector.js': 'export const nothing = 1',
      'README.md': ' ',
    })
    const { problems } = await checkFolder(folder)
    expect(problems).toEqual([
      '"pc-stats" is a widget built into ShiftPane. Pick another id.',
      "Proprietary isn't an OSI-approved SPDX id. Use one such as MIT or Apache-2.0.",
      'README.md is missing or empty.',
      'collector.js: collector.js has to export a collector: export default defineCollector(...)',
    ])
  })
})

describe('packFolder', () => {
  it('packs the checked files and any icon into the same zip every time', async () => {
    await write({ 'notes.txt': 'not part of the package' })
    await writeFile(join(folder, 'icon.png'), new Uint8Array([137, 80, 78, 71]))
    const first = await packFolder(folder)
    const second = await packFolder(folder)
    if (!first.ok || !second.ok) throw new Error('not packed')
    expect(first.fileName).toBe('repo-stars-1.0.0.zip')
    expect(first.sha256).toBe(second.sha256)
    expect([...openPackage(first.zip).files.keys()].sort()).toEqual([
      'LICENSE',
      'README.md',
      'collector.js',
      'icon.png',
      'manifest.json',
      'sample.json',
      'view.json',
    ])
  })

  it("won't pack a widget that fails a check", async () => {
    await write({ LICENSE: '' })
    expect((await packFolder(folder)).ok).toBe(false)
  })
})
