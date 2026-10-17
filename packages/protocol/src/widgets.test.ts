import { describe, expect, it } from 'vitest'
import { MediaData, PcStatsData, WidgetId } from './widgets.ts'

describe('PcStatsData', () => {
  it('accepts full stats and stats the PC could only partly read', () => {
    expect(
      PcStatsData.safeParse({
        cpuPercent: 34.5,
        memory: { usedBytes: 9e9, totalBytes: 16e9 },
        gpuPercent: 12,
        network: { receivedPerSecond: 120_000, sentPerSecond: 4_000 },
      }).success,
    ).toBe(true)
    expect(
      PcStatsData.safeParse({ cpuPercent: null, memory: null, gpuPercent: null, network: null })
        .success,
    ).toBe(true)
  })

  it('rejects percentages and byte counts that cannot be real', () => {
    const base = { cpuPercent: 10, memory: null, gpuPercent: null, network: null }
    expect(PcStatsData.safeParse({ ...base, cpuPercent: 101 }).success).toBe(false)
    expect(PcStatsData.safeParse({ ...base, cpuPercent: -1 }).success).toBe(false)
    expect(
      PcStatsData.safeParse({ ...base, memory: { usedBytes: -1, totalBytes: 1 } }).success,
    ).toBe(false)
  })
})

describe('MediaData', () => {
  it('accepts nothing playing and a playing track', () => {
    const idle = {
      status: 'none',
      title: null,
      artist: null,
      app: null,
      canPlayPause: false,
      canNext: false,
      canPrevious: false,
    }
    expect(MediaData.safeParse(idle).success).toBe(true)
    expect(
      MediaData.safeParse({
        ...idle,
        status: 'playing',
        title: 'Song',
        artist: 'Artist',
        app: 'Spotify',
        canPlayPause: true,
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown status and oversized text', () => {
    const base = {
      status: 'playing',
      title: 'x',
      artist: null,
      app: null,
      canPlayPause: true,
      canNext: true,
      canPrevious: true,
    }
    expect(MediaData.safeParse({ ...base, status: 'buffering' }).success).toBe(false)
    expect(MediaData.safeParse({ ...base, title: 'x'.repeat(257) }).success).toBe(false)
  })
})

describe('WidgetId', () => {
  it('matches manifest-style ids only', () => {
    for (const id of ['pc-stats', 'media', 'clock', 'a1'])
      expect(WidgetId.safeParse(id).success).toBe(true)
    for (const id of ['', '-x', 'PC', 'a b', 'a/b', 'x'.repeat(65)]) {
      expect(WidgetId.safeParse(id).success, id).toBe(false)
    }
  })
})
