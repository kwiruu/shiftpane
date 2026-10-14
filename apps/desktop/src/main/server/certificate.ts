import { X509Certificate } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generate } from 'selfsigned'

export interface TlsCredentials {
  cert: string
  key: string
  /** SHA-256 fingerprint, shown in the desktop app so the user can match it on the phone. */
  fingerprint: string
}

const FILE = 'tls.json'
const VALID_DAYS = 397 // the longest validity Apple platforms accept for TLS server certs
const RENEW_BEFORE_DAYS = 30

/**
 * Loads the self-signed certificate from `dir`, or creates one. It is regenerated when it
 * is close to expiry or does not cover every host in `hosts` (e.g. the PC got a new IP),
 * which costs the user one more "proceed anyway" on the phone, so it is otherwise reused.
 */
export async function loadOrCreateCertificate(
  dir: string,
  hosts: readonly string[],
  now = new Date(),
) {
  const stored = await readStored(dir)
  if (stored && isUsable(stored.cert, hosts, now)) return stored
  const created = await createCertificate(hosts, now)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, FILE), JSON.stringify(created), { mode: 0o600 })
  return created
}

export async function createCertificate(
  hosts: readonly string[],
  now = new Date(),
): Promise<TlsCredentials> {
  const notAfter = new Date(now)
  notAfter.setDate(notAfter.getDate() + VALID_DAYS)
  const pems = await generate([{ name: 'commonName', value: 'ShiftPane on this PC' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: now,
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...hosts.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  })
  return {
    cert: pems.cert,
    key: pems.private,
    fingerprint: new X509Certificate(pems.cert).fingerprint256,
  }
}

function isUsable(pem: string, hosts: readonly string[], now: Date): boolean {
  try {
    const cert = new X509Certificate(pem)
    const renewAt = new Date(cert.validTo)
    renewAt.setDate(renewAt.getDate() - RENEW_BEFORE_DAYS)
    return now < renewAt && hosts.every((host) => cert.checkIP(host) === host)
  } catch {
    return false
  }
}

async function readStored(dir: string): Promise<TlsCredentials | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, FILE), 'utf8')) as Partial<TlsCredentials>
    if (
      typeof parsed.cert === 'string' &&
      typeof parsed.key === 'string' &&
      typeof parsed.fingerprint === 'string'
    ) {
      return { cert: parsed.cert, key: parsed.key, fingerprint: parsed.fingerprint }
    }
  } catch {
    // Missing or corrupt: fall through and create a new one.
  }
  return null
}
