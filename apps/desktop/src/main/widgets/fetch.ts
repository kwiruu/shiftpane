import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import type { IncomingMessage } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { HostFetch, HostRequest, HostResponse } from '@shiftpane/widget-runtime'
import { isHostAllowed, type Permissions } from '@shiftpane/widget-sdk'

/**
 * The `fetch` a collector gets: every request is checked against the widget's manifest.
 *
 * - An internet host has to be in `permissions.network`, over https, on the usual port. Its name
 *   has to lead to public addresses only, checked as the connection is made, so a widget can't
 *   reach the user's router or LAN by pointing a public name at it.
 * - An app on this PC or the LAN has to be in `permissions.local` as that exact host and port.
 *
 * Redirects are followed a few times, each one checked the same way. Answers are capped in size.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 10_000
const USER_AGENT = 'ShiftPane-Widget'

/** Headers Node works out itself, or that would change what comes back in ways a collector can't read. */
const DROPPED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
])

/** Addresses a public host name must never lead to: this PC, the LAN, and other special ranges. */
const NOT_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
// IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) are checked against the IPv4 rules above.
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

/** Whether an IP address is on the public internet, not this PC, the LAN or a special range. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  return !NOT_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

export type HostKind = 'network' | 'local'

/** How a widget may reach a URL, or an error saying why it may not. */
export function checkUrl(url: URL, permissions: Pick<Permissions, 'network' | 'local'>): HostKind {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`a widget can't fetch ${url.protocol} addresses`)
  }
  if (url.username || url.password) throw new Error("a widget can't put a password in a URL")
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  if (permissions.local.includes(`${url.hostname}:${port}`)) return 'local'
  if (isHostAllowed(url.hostname, permissions.network)) {
    if (url.protocol !== 'https:') throw new Error(`use https to reach ${url.hostname}`)
    if (port !== '443') throw new Error(`${url.hostname} can only be reached on its usual port`)
    return 'network'
  }
  throw new Error(`${url.hostname} isn't one of this widget's hosts`)
}

type Lookup = typeof dnsLookup

/** Resolves a name like `lookup` does, refusing it unless every address is public. */
export function publicOnly(lookup: Lookup = dnsLookup) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: (...args: unknown[]) => void,
  ) => {
    lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error)
      const first = addresses[0]
      if (!first || addresses.some((found) => !isPublicAddress(found.address))) {
        const refused = new Error(`${hostname} leads to an address on this PC or its network`)
        return callback(Object.assign(refused, { code: 'EADDRNOTAVAIL' }))
      }
      if (options.all) callback(null, addresses)
      else callback(null, first.address, first.family)
    })
  }
}

export interface GuardOptions {
  /** DNS, for tests. */
  lookup?: Lookup
}

/** The `fetch` for one widget's collector, allowed what its manifest lists and nothing else. */
export function guardedFetch(
  permissions: Pick<Permissions, 'network' | 'local'>,
  options: GuardOptions = {},
): HostFetch {
  const lookup = publicOnly(options.lookup)
  return async (request, signal) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      throw new Error(`${request.url} isn't a URL`)
    }
    let method = request.method
    let body = request.body
    for (let hop = 0; ; hop += 1) {
      const kind = checkUrl(url, permissions)
      const answer = await send(url, { ...request, method, body }, kind, signal, lookup)
      const location = answer.headers.location
      if (![301, 302, 303, 307, 308].includes(answer.status) || !location) return answer
      if (hop === MAX_REDIRECTS) throw new Error(`${url.hostname} redirected too many times`)
      url = new URL(location, url)
      if (
        answer.status === 303 ||
        ((answer.status === 301 || answer.status === 302) && method === 'POST')
      ) {
        method = 'GET'
        body = undefined
      }
    }
  }
}

function send(
  url: URL,
  request: HostRequest,
  kind: HostKind,
  signal: AbortSignal,
  lookup: ReturnType<typeof publicOnly>,
): Promise<HostResponse> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT }
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase()
    if (!DROPPED_HEADERS.has(lower)) headers[lower] = value
  }
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const outgoing = client.request(
      url,
      {
        method: request.method,
        headers,
        signal,
        timeout: REQUEST_TIMEOUT_MS,
        // Internet hosts only ever connect to the public addresses their names resolve to.
        ...(kind === 'network' && { lookup: lookup as never }),
      },
      (incoming: IncomingMessage) => {
        const chunks: Buffer[] = []
        let size = 0
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BODY_BYTES) {
            incoming.destroy()
            reject(new Error(`${url.hostname} answered with more than 2 MB`))
            return
          }
          chunks.push(chunk)
        })
        incoming.on('error', reject)
        incoming.on('end', () => {
          const answerHeaders: Record<string, string> = {}
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) {
              answerHeaders[name] = Array.isArray(value) ? value.join(', ') : value
            }
          }
          resolve({
            status: incoming.statusCode ?? 0,
            statusText: incoming.statusMessage ?? '',
            url: url.href,
            headers: answerHeaders,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    outgoing.on('timeout', () =>
      outgoing.destroy(new Error(`${url.hostname} didn't answer in time`)),
    )
    outgoing.on('error', (error: Error) =>
      reject(signal.aborted ? new Error('the run ended') : error),
    )
    if (request.body !== undefined) outgoing.write(request.body)
    outgoing.end()
  })
}
