import type { MonitorInfo, MonitorSource } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { monitorLabel, sameSource, sourceOfValue, sourceValue, VIRTUAL } from './sources.ts'

const monitor = (over: Partial<MonitorInfo> = {}): MonitorInfo => ({
  id: '2528732444',
  name: 'Mi Monitor',
  width: 1920,
  height: 1080,
  primary: true,
  ...over,
})

describe('source values', () => {
  it('round-trips the virtual monitor and a copy of a real one', () => {
    const sources: MonitorSource[] = [VIRTUAL, { kind: 'mirror', displayId: '2528732444' }]
    for (const source of sources) {
      expect(sourceOfValue(sourceValue(source))).toEqual(source)
    }
  })

  it('reads nothing from a value that is not one of ours', () => {
    for (const value of ['', 'mirror:', 'mirror', 'camera', 'Virtual']) {
      expect(sourceOfValue(value), value).toBeNull()
    }
  })
})

describe('sameSource', () => {
  it('compares the kind, and the monitor for a copy', () => {
    const mirror: MonitorSource = { kind: 'mirror', displayId: '1' }
    expect(sameSource(VIRTUAL, { kind: 'virtual' })).toBe(true)
    expect(sameSource(mirror, { kind: 'mirror', displayId: '1' })).toBe(true)
    expect(sameSource(mirror, { kind: 'mirror', displayId: '2' })).toBe(false)
    expect(sameSource(mirror, VIRTUAL)).toBe(false)
    expect(sameSource(VIRTUAL, mirror)).toBe(false)
  })
})

describe('monitorLabel', () => {
  it('uses the monitor name, or its place in the list when it has none', () => {
    expect(monitorLabel(monitor(), 0)).toBe('Mi Monitor')
    expect(monitorLabel(monitor({ name: '' }), 1)).toBe('Display 2')
  })
})
