import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkFolder, type HostFetch } from '@shiftpane/widget-runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromArgs, runOnce } from './dev.ts'

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

describe('dev', () => {
  it('turns --config pairs into typed values, with defaults for the rest', () => {
    expect(configFromArgs(manifest.config as never, ['repo=kwiruu/shiftpane'])).toEqual({
      config: { repo: 'kwiruu/shiftpane', top: 3 },
      problems: [],
    })
    expect(configFromArgs(manifest.config as never, ['top=40', 'colour=red']).problems).toEqual([
      'There is no config field "colour".',
      'Top has to be between 1 and 10.',
    ])
  })

  it('runs the collector with its declared secret from the environment, and finds missing bindings', async () => {
    const report = await checkFolder(folder)
    if (!report.widget) throw new Error('no widget')
    const fetch: HostFetch = async (request) => ({
      status: 200,
      statusText: 'OK',
      url: request.url,
      headers: {},
      body: JSON.stringify({ stargazers_count: 42 }),
    })
    const run = await runOnce(
      report.widget,
      { repo: 'a/b' },
      { GITHUB_TOKEN: 'x', OTHER: 'y' },
      fetch,
    )
    expect(run).toMatchObject({ ok: true, output: { stars: 42, token: true }, missing: [] })

    const asked = await runOnce(report.widget, {}, {}, fetch)
    expect(asked.unset).toEqual(['repo'])

    const renamed = {
      ...report.widget,
      view: { small: { type: 'value' as const, bind: '/count' } },
    }
    expect((await runOnce(renamed, { repo: 'a/b' }, {}, fetch)).missing).toEqual(['/count'])
  })
})
