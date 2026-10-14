import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  generatePairingToken,
  PairingToken,
  pairingUrl,
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
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (a, b) => {
        expect(tokensEqual(a, b)).toBe(a === b)
      }),
    )
    const token = generatePairingToken()
    expect(tokensEqual(token, PairingToken.parse(`${token}`))).toBe(true)
  })
})
