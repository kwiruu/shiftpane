import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HELPER_PROTOCOL_VERSION } from './version.ts'

describe('HELPER_PROTOCOL_VERSION', () => {
  it('matches PROTOCOL_VERSION in the Rust protocol', () => {
    const source = readFileSync(
      new URL('../../../native/crates/core/src/protocol.rs', import.meta.url),
      'utf8',
    )
    const match = /pub const PROTOCOL_VERSION: u32 = (\d+);/.exec(source)
    expect(match, 'PROTOCOL_VERSION not found in protocol.rs').not.toBeNull()
    expect(HELPER_PROTOCOL_VERSION).toBe(Number(match?.[1]))
  })
})
