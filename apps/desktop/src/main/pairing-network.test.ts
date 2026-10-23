import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PairingService } from './pairing.ts'

const fake = vi.hoisted(() => ({
  hosts: [{ address: '192.168.1.109', interface: 'Wi-Fi' }],
  tls: { cert: 'test-cert', key: 'test-key', fingerprint: 'test-fingerprint' },
  server: { port: 47820, updateTls: vi.fn(), close: vi.fn(async () => {}) },
  request: undefined as ((stage: 'page' | 'test' | 'socket') => void) | undefined,
}))
vi.mock('./server/lan.ts', () => ({ lanAddresses: () => fake.hosts }))
vi.mock('./server/certificate.ts', () => ({ loadOrCreateCertificate: vi.fn(async () => fake.tls) }))
vi.mock('./server/server.ts', () => ({
  startLanServer: vi.fn(async (options) => {
    fake.request = options.onPhoneRequest
    return fake.server
  }),
}))
vi.mock('qrcode', () => ({ default: { toString: async (url: string) => `<svg>${url}</svg>` } }))
let service: PairingService
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  fake.hosts = [{ address: '192.168.1.109', interface: 'Wi-Fi' }]
  fake.request = undefined
  service = new PairingService({
    dataDir: '',
    staticRoot: '',
    platform: 'windows',
    storage: { read: async () => null, write: async () => {} },
  })
})
afterEach(async () => {
  await service.stop()
  vi.useRealTimers()
})

it('updates the address, QR and TLS context on a hotspot switch without restarting the server', async () => {
  await service.start()
  const initial = service.state
  expect(initial.status).toBe('ready')
  fake.hosts = [{ address: '172.20.10.2', interface: 'Hotspot' }]
  await vi.advanceTimersByTimeAsync(5000)
  expect(service.state).toMatchObject({ status: 'ready', host: '172.20.10.2', port: 47820 })
  if (service.state.status === 'ready') {
    expect(service.state.qrSvg).toContain('172.20.10.2')
    expect(service.state.connectionTestQrSvg).toContain('172.20.10.2:47820/connection-test')
  }
  expect(fake.server.updateTls).toHaveBeenCalledWith(fake.tls)
  expect(fake.server.close).not.toHaveBeenCalled()
})
it('keeps a selected adapter while it remains available', async () => {
  fake.hosts.push({ address: '10.0.0.2', interface: 'Ethernet' })
  await service.start()
  await service.selectHost('10.0.0.2')
  fake.hosts = [...fake.hosts, { address: '172.20.10.2', interface: 'Hotspot' }]
  await service.refreshNetwork()
  expect(service.state).toMatchObject({ host: '10.0.0.2' })
})
it('recovers automatically after losing all addresses', async () => {
  await service.start()
  fake.hosts = []
  await service.refreshNetwork()
  expect(service.state.status).toBe('error')
  fake.hosts = [{ address: '172.20.10.2', interface: 'Hotspot' }]
  await service.refreshNetwork()
  expect(service.state).toMatchObject({ status: 'ready', host: '172.20.10.2' })
})
it('starts the server when an initially offline PC gains a network', async () => {
  fake.hosts = []
  await service.start()
  expect(service.state.status).toBe('error')
  fake.hosts = [{ address: '172.20.10.2', interface: 'Hotspot' }]
  await vi.advanceTimersByTimeAsync(5000)
  expect(service.state.status).toBe('ready')
})
it('records separate request stages and clears them for a new QR or network', async () => {
  await service.start()
  for (const stage of ['page', 'test', 'socket'] as const) fake.request?.(stage)
  await vi.advanceTimersByTimeAsync(0)
  if (service.state.status !== 'ready') throw new Error('Expected ready state')
  expect(Object.values(service.state.diagnostics).every((at) => typeof at === 'number')).toBe(true)
  await service.newCode()
  expect(service.state).toMatchObject({
    diagnostics: { pageAt: null, testAt: null, socketAt: null },
  })
  fake.request?.('test')
  await vi.advanceTimersByTimeAsync(0)
  fake.hosts = [{ address: '172.20.10.2', interface: 'Hotspot' }]
  await service.refreshNetwork()
  expect(service.state).toMatchObject({
    diagnostics: { pageAt: null, testAt: null, socketAt: null },
  })
})
it('stops polling when shut down', async () => {
  await service.start()
  await service.stop()
  fake.hosts = [{ address: '172.20.10.2', interface: 'Hotspot' }]
  await vi.advanceTimersByTimeAsync(15000)
  expect(fake.server.updateTls).not.toHaveBeenCalled()
})
