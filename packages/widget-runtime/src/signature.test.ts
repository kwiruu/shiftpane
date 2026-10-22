import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySignature } from './signature.ts'

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

describe('verifySignature', () => {
  const current = pair()
  const next = pair()
  const bytes = new TextEncoder().encode('{"format":1,"widgets":[]}\n')
  const signature = `${sign(null, bytes, current.privateKey).toString('base64')}\n`

  it('accepts the bytes the key signed, from the current key or the next', () => {
    expect(verifySignature(bytes, signature, [current.publicKey])).toBe(true)
    expect(verifySignature(bytes, signature, [next.publicKey, current.publicKey])).toBe(true)
  })

  it('refuses changed bytes, another key and garbage', () => {
    const changed = new TextEncoder().encode('{"format":1,"widgets":[1]}\n')
    expect(verifySignature(changed, signature, [current.publicKey])).toBe(false)
    expect(verifySignature(bytes, signature, [next.publicKey])).toBe(false)
    expect(verifySignature(bytes, 'not a signature', [current.publicKey])).toBe(false)
    expect(verifySignature(bytes, signature, ['not a key'])).toBe(false)
  })
})
