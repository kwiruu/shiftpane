import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOrCreateCertificate } from './certificate.ts'

const tempDir = () => mkdtemp(join(tmpdir(), 'shiftpane-cert-'))

describe('loadOrCreateCertificate', () => {
  it('creates a certificate valid for the LAN address and stores it privately', async () => {
    const dir = await tempDir()
    const tls = await loadOrCreateCertificate(dir, ['192.168.1.20'])
    const cert = new X509Certificate(tls.cert)
    expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20')
    expect(cert.checkHost('localhost')).toBe('localhost')
    expect(tls.fingerprint).toBe(cert.fingerprint256)
    if (process.platform !== 'win32') {
      expect((await stat(join(dir, 'tls.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('reuses the stored certificate while it still fits', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateCertificate(dir, ['192.168.1.20'])
    const second = await loadOrCreateCertificate(dir, ['192.168.1.20'])
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  it('regenerates when the PC has a new address', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateCertificate(dir, ['192.168.1.20'])
    const moved = await loadOrCreateCertificate(dir, ['10.0.0.7'])
    expect(moved.fingerprint).not.toBe(first.fingerprint)
    expect(new X509Certificate(moved.cert).checkIP('10.0.0.7')).toBe('10.0.0.7')
  })

  it('regenerates near expiry and when the stored file is corrupt', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateCertificate(dir, ['192.168.1.20'])
    const later = new Date(Date.now() + 380 * 24 * 3600 * 1000)
    expect((await loadOrCreateCertificate(dir, ['192.168.1.20'], later)).fingerprint).not.toBe(
      first.fingerprint,
    )

    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'tls.json'), '{not json')
    const recovered = await loadOrCreateCertificate(dir, ['192.168.1.20'])
    expect(JSON.parse(await readFile(join(dir, 'tls.json'), 'utf8')).fingerprint).toBe(
      recovered.fingerprint,
    )
  })
})
