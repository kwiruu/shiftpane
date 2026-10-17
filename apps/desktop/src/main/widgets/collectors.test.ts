import { describe, expect, it } from 'vitest'
import { createCpuMeter, NOTHING_PLAYING, toMedia, toPcStats } from './collectors.ts'

const node = { cpuPercent: 50, usedBytes: 4e9, totalBytes: 8e9 }

describe('toPcStats', () => {
  it('uses the helper numbers when it has them', () => {
    expect(
      toPcStats(
        {
          cpuPercent: 12.5,
          memoryUsedBytes: 11e9,
          memoryTotalBytes: 16e9,
          gpuPercent: 18,
          networkReceivedPerSecond: 5900,
          networkSentPerSecond: 5000,
        },
        node,
      ),
    ).toEqual({
      cpuPercent: 12.5,
      memory: { usedBytes: 11e9, totalBytes: 16e9 },
      gpuPercent: 18,
      network: { receivedPerSecond: 5900, sentPerSecond: 5000 },
    })
  })

  it("falls back to Node's CPU and memory without the helper, and leaves the rest empty", () => {
    expect(toPcStats(null, node)).toEqual({
      cpuPercent: 50,
      memory: { usedBytes: 4e9, totalBytes: 8e9 },
      gpuPercent: null,
      network: null,
    })
  })

  it('clamps numbers the counters can overshoot', () => {
    const stats = toPcStats(
      {
        cpuPercent: 104,
        memoryUsedBytes: 9e9,
        memoryTotalBytes: 8e9,
        gpuPercent: -1,
        networkReceivedPerSecond: null,
        networkSentPerSecond: 3,
      },
      node,
    )
    expect(stats.cpuPercent).toBe(100)
    expect(stats.gpuPercent).toBe(0)
    expect(stats.memory).toEqual({ usedBytes: 8e9, totalBytes: 8e9 })
    expect(stats.network).toBeNull()
  })
})

describe('toMedia', () => {
  it('passes the state through and trims oversized text', () => {
    const media = toMedia({
      status: 'playing',
      title: 'x'.repeat(300),
      artist: 'Artist',
      app: 'Spotify',
      canPlayPause: true,
      canNext: true,
      canPrevious: false,
    })
    expect(media.title).toHaveLength(256)
    expect(media).toMatchObject({
      status: 'playing',
      artist: 'Artist',
      app: 'Spotify',
      canPrevious: false,
    })
  })

  it('has a nothing-playing value that is valid media data', () => {
    expect(toMedia({ ...NOTHING_PLAYING })).toEqual(NOTHING_PLAYING)
  })
})

describe('createCpuMeter', () => {
  it('reports the busy share between two readings', () => {
    const readings = [
      [{ times: { user: 100, nice: 0, sys: 0, irq: 0, idle: 900 } }],
      [{ times: { user: 400, nice: 0, sys: 0, irq: 0, idle: 1600 } }],
    ]
    let call = 0
    const meter = createCpuMeter(() => readings[Math.min(call++, 1)] as never)
    expect(meter()).toBeNull()
    expect(meter()).toBeCloseTo(30)
  })
})
