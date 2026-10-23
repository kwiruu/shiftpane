import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  generateDeviceKey,
  generatePairingCode,
  generatePairingToken,
  PairingToken,
  PhoneAuth,
  pairingUrl,
  parsePairingCode,
  parsePairingHash,
  tokensEqual,
} from './pairing.ts'

describe('pairing tokens', () => {
  it('generates distinct base64url tokens with at least 128 bits', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generatePairingToken))
    expect(tokens.size).toBe(1000)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{22,}$/)
  })

  it('puts the token in the fragment and reads it back', () => {
    const token = generatePairingToken()
    const url = new URL(pairingUrl({ host: '192.168.1.20', port: 47820, token }))
    expect(url.protocol).toBe('https:')
    expect(url.search).toBe('')
    expect(parsePairingHash(url.hash)).toBe(token)
  })

  it('returns null for missing or malformed tokens', () => {
    expect(parsePairingHash('')).toBeNull()
    expect(parsePairingHash('#t=short')).toBeNull()
    expect(parsePairingHash('#t=has spaces and+plus/slash===')).toBeNull()
  })

  it('compares tokens exactly', () => {
    // Tokens are short; long strings only made this slow enough to time out on a busy CI runner.
    const text = fc.string({ unit: 'binary', maxLength: 64 })
    fc.assert(
      fc.property(text, text, (a, b) => {
        expect(tokensEqual(a, b)).toBe(a === b)
      }),
    )
    // Equal strings rarely come up at random, so check them on purpose too.
    fc.assert(
      fc.property(text, (a) => {
        expect(tokensEqual(a, `${a}`)).toBe(true)
      }),
    )
    const token = generatePairingToken()
    expect(tokensEqual(token, PairingToken.parse(`${token}`))).toBe(true)
  })
})

describe('pairing codes', () => {
  it('generates six digits, leading zeros included', () => {
    const codes = Array.from({ length: 2000 }, generatePairingCode)
    for (const code of codes) expect(code).toMatch(/^\d{6}$/)
    expect(new Set(codes).size).toBeGreaterThan(1990)
    expect(codes.some((code) => code.startsWith('0'))).toBe(true)
  })

  it('reads a code as typed, ignoring spaces and dashes', () => {
    expect(parsePairingCode('123456')).toBe('123456')
    expect(parsePairingCode(' 123 456 ')).toBe('123456')
    expect(parsePairingCode('123-456')).toBe('123456')
    for (const partial of ['', '12345', '1234567', '12345a', '١٢٣٤٥٦']) {
      expect(parsePairingCode(partial), partial).toBeNull()
    }
  })
})

describe('device keys', () => {
  it('are as strong as pairing tokens', () => {
    const keys = new Set(Array.from({ length: 1000 }, generateDeviceKey))
    expect(keys.size).toBe(1000)
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{22,}$/)
  })

  it('only take one of the three ways to prove a phone may connect', () => {
    const token = generatePairingToken()
    const key = generateDeviceKey()
    expect(PhoneAuth.safeParse({ kind: 'token', token }).success).toBe(true)
    expect(PhoneAuth.safeParse({ kind: 'code', code: '000000' }).success).toBe(true)
    expect(PhoneAuth.safeParse({ kind: 'key', deviceId: 'abcdefgh', key }).success).toBe(true)
    expect(PhoneAuth.safeParse({ kind: 'key', deviceId: 'abcdefgh', token }).success).toBe(false)
    expect(PhoneAuth.safeParse({ kind: 'code', token }).success).toBe(false)
  })
})
