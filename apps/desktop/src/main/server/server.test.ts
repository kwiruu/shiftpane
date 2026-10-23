import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CloseCode,
  DEFAULT_PORT,
  generatePairingToken,
  type PcMessage,
  PROTOCOL_VERSION,
  tokensEqual,
} from '@shiftpane/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createCertificate } from './certificate.ts'
import { PhoneHub } from './phone-hub.ts'
import { candidatePorts, isRemoteDevice, type LanServer, startLanServer } from './server.ts'

const token = generatePairingToken()
let server: LanServer
let ca: string
let hub: PhoneHub

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'shiftpane-www-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>phone</title>')
  await writeFile(join(root, 'assets', 'app-1.js'), 'console.log(1)')
  const tls = await createCertificate(['127.0.0.1'])
  ca = tls.cert
  hub = new PhoneHub({
    admit: (auth) =>
      auth.kind === 'token' && tokensEqual(auth.token, token)
        ? { ok: true, deviceId: 'device-1' }
        : { ok: false, code: CloseCode.unauthorized, reason: 'pairing token rejected' },
    pc: { name: 'test', platform: 'linux' },
    features: () => ({ display: false, remoteControl: false }),
  })
  server = await startLanServer({ tls, staticRoot: root, hub, port: 0, host: '127.0.0.1' })
})

afterAll(() => server.close())

function get(path: string) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.port, path, ca }, (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      })
      req.on('error', reject)
      req.end()
    },
  )
}

function connect(headers: Record<string, string> = { origin: `https://127.0.0.1:${server.port}` }) {
  return new WebSocket(`wss://127.0.0.1:${server.port}/ws`, { ca, headers })
}

const nextMessage = (ws: WebSocket) =>
  new Promise<PcMessage>((resolve) =>
    ws.once('message', (data) => resolve(JSON.parse(data.toString()))),
  )
const closed = (ws: WebSocket) =>
  new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))

const hello = (pairingToken: string) =>
  JSON.stringify({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    auth: { kind: 'token', token: pairingToken },
    device: {
      name: 'test phone',
      viewport: { width: 400, height: 800 },
      devicePixelRatio: 2,
      touch: true,
    },
  })

describe('LAN server', () => {
  it('serves a standalone connection test without pairing or script assets', async () => {
    const page = await get('/connection-test')
    expect(page.status).toBe(200)
    expect(page.body).toContain('Connection reached your PC')
    expect(page.body).not.toContain('<script')
    expect(page.headers['cache-control']).toBe('no-store')
    expect(hub.phones).toHaveLength(0)
  })

  it('serves the phone app over HTTPS with security headers', async () => {
    const page = await get('/')
    expect(page.status).toBe(200)
    expect(page.body).toContain('<title>phone</title>')
    expect(page.headers['content-security-policy']).toContain("default-src 'self'")
    expect(page.headers['content-security-policy']).toContain(
      `connect-src 'self' wss://127.0.0.1:${server.port};`,
    )
    expect(page.headers['cache-control']).toBe('no-cache')
    expect((await get('/assets/app-1.js')).headers['cache-control']).toContain('immutable')
    expect((await get('/../../etc/passwd')).status).toBe(404)
  })

  it('pairs a phone that presents the token', async () => {
    const ws = connect()
    await new Promise((resolve) => ws.once('open', resolve))
    ws.send(hello(token))
    expect(await nextMessage(ws)).toMatchObject({ type: 'welcome', pc: { platform: 'linux' } })
    expect(hub.phones.map((p) => p.name)).toContain('test phone')
    ws.send(JSON.stringify({ type: 'ping', at: 7 }))
    expect(await nextMessage(ws)).toEqual({ type: 'pong', at: 7 })
    const done = closed(ws)
    ws.close()
    await done
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hub.phones).toEqual([])
  })

  it('closes a socket with the wrong token', async () => {
    const ws = connect()
    await new Promise((resolve) => ws.once('open', resolve))
    ws.send(hello(generatePairingToken()))
    expect(await closed(ws)).toBe(CloseCode.unauthorized)
  })

  it('moves on when the port phones used last is taken', async () => {
    const tls = await createCertificate(['127.0.0.1'])
    const root = await mkdtemp(join(tmpdir(), 'shiftpane-www-'))
    const other = await startLanServer({
      tls,
      staticRoot: root,
      hub,
      port: server.port,
      host: '127.0.0.1',
    })
    try {
      expect(other.port).not.toBe(server.port)
      expect(other.port).toBeGreaterThan(0)
    } finally {
      await other.close()
    }
  })

  it('refuses upgrades from another origin or path', async () => {
    const foreign = connect({ origin: 'https://evil.example' })
    const error = await new Promise<Error>((resolve) => foreign.once('error', resolve))
    expect(error.message).toMatch(/403/)
    const wrongPath = new WebSocket(`wss://127.0.0.1:${server.port}/other`, { ca })
    expect(
      (await new Promise<Error>((resolve) => wrongPath.once('error', resolve))).message,
    ).toMatch(/403/)
  })
})

describe('candidatePorts', () => {
  it('tries the last port, then the fixed range, then any free port', () => {
    expect(candidatePorts()).toEqual([...Array.from({ length: 10 }, (_, i) => DEFAULT_PORT + i), 0])
    expect(candidatePorts(50_000).slice(0, 2)).toEqual([50_000, DEFAULT_PORT])
    expect(
      candidatePorts(DEFAULT_PORT + 3).filter((port) => port === DEFAULT_PORT + 3),
    ).toHaveLength(1)
    expect(candidatePorts(0)).toEqual([0])
  })
})

it('does not count PC or loopback checks as a phone reaching the server', () => {
  expect(isRemoteDevice('192.168.1.36', '192.168.1.109')).toBe(true)
  expect(isRemoteDevice('::ffff:192.168.1.36', '::ffff:192.168.1.109')).toBe(true)
  expect(isRemoteDevice('192.168.1.109', '192.168.1.109')).toBe(false)
  expect(isRemoteDevice('127.0.0.2', '127.0.0.1')).toBe(false)
  expect(isRemoteDevice('::1', '::1')).toBe(false)
  expect(isRemoteDevice(undefined, undefined)).toBe(false)
})
