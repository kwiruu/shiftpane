import { describe, expect, it } from 'vitest'
import { CaptureGate } from './gate.ts'

describe('CaptureGate', () => {
  it('hands an armed source over once', () => {
    const gate = new CaptureGate<string>()
    expect(gate.armed).toBe(false)
    gate.arm('screen:1:0')
    expect(gate.armed).toBe(true)
    expect(gate.take()).toBe('screen:1:0')
    expect(gate.armed).toBe(false)
    expect(gate.take()).toBeNull()
  })

  it('gives nothing when nothing was armed', () => {
    expect(new CaptureGate<string>().take()).toBeNull()
  })

  it('lets the latest source replace an earlier one', () => {
    const gate = new CaptureGate<string>()
    gate.arm('screen:1:0')
    gate.arm('screen:2:0')
    expect(gate.take()).toBe('screen:2:0')
  })

  it('expires a source that is not taken in time', () => {
    let now = 1_000
    const gate = new CaptureGate<string>({ ttlMs: 500, now: () => now })
    gate.arm('screen:1:0')
    now = 1_499
    expect(gate.armed).toBe(true)
    now = 1_500
    expect(gate.armed).toBe(false)
    expect(gate.take()).toBeNull()
  })

  it('can be cleared', () => {
    const gate = new CaptureGate<string>()
    gate.arm('screen:1:0')
    gate.clear()
    expect(gate.take()).toBeNull()
  })
})
