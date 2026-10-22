import { createPublicKey, verify } from 'node:crypto'

/**
 * Whether any of `publicKeys` (base64 SPKI Ed25519) signed exactly these bytes. `signature` is the
 * content of a `.sig` file: base64, maybe with a trailing newline. The registry signs the bytes it
 * stores, so they are checked as they came, before anything parses them.
 */
export function verifySignature(
  bytes: Uint8Array,
  signature: string,
  publicKeys: readonly string[],
): boolean {
  const signed = Buffer.from(signature.trim(), 'base64')
  if (signed.length !== 64) return false
  return publicKeys.some((key) => {
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(key, 'base64'),
        format: 'der',
        type: 'spki',
      })
      return verify(null, bytes, publicKey, signed)
    } catch {
      return false
    }
  })
}
