import type { CpuInfo } from 'node:os'
import { sourceSchemas } from '@shiftpane/widget-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { HelperChannel } from '../display/helper-host.ts'
import { createCoreMeter, SourceReader } from './sources.ts'

/** A helper that answers each call from this table, counting the calls. */
function fakeHelper(answers: Record<string, unknown>) {
  const calls: string[] = []
  const channel = {
    call: vi.fn(async (method: string) => {
      calls.push(method)
      if (!(method in answers)) throw new Error(`no ${method}`)
      return answers[method]
    }),
  } as unknown as HelperChannel
  return { helper: async () => channel, calls }
}

const stats = {
  type: 'systemStats',
  cpuPercent: 30,
  memoryUsedBytes: 8e9,
  memoryTotalBytes: 16e9,
  gpuPercent: 12,
  networkReceivedPerSecond: 1000,
  networkSentPerSecond: 10,
  gpuTemperatureCelsius: 61.5,
  gpuFanRpm: 1200,
}

const everything = {
  'system.stats': stats,
  'disks.state': {
    type: 'disks',
    drives: [
      {
        name: 'C:',
        usedBytes: 400e9,
        totalBytes: 500e9,
        readPerSecond: 1000,
        writePerSecond: null,
      },
    ],
  },
  'processes.top': {
    type: 'processes',
    processes: [{ name: 'chrome', cpuPercent: 12.4, memoryBytes: 1.5 * 1024 ** 3 }],
  },
  'power.state': {
    type: 'power',
    battery: { percent: 36, charging: false, minutesLeft: 54 },
  },
  'audio.state': { type: 'audio', volumePercent: 68, muted: false, device: 'Speakers' },
  'window.active': { type: 'activeWindow', app: 'Visual Studio Code', title: 'widget.ts' },
  'media.state': {
    type: 'media',
    status: 'playing',
    title: 'Late Night Drive',
    artist: 'Neon Coast',
    app: 'Spotify',
    canPlayPause: true,
    canNext: true,
    canPrevious: true,
  },
}

describe('SourceReader', () => {
  it('reads every source in the shape the SDK promises', async () => {
    const { helper } = fakeHelper(everything)
    const reader = new SourceReader({ helper, coreMeter: () => [10, 20] })
    const sources = await reader.read([
      'cpu',
      'memory',
      'gpu',
      'network',
      'temperatures',
      'disks',
      'processes',
      'battery',
      'audio',
      'active-window',
      'media',
      'system',
    ])
    reader.stop()
    for (const [name, value] of Object.entries(sources)) {
      const schema = sourceSchemas[name as keyof typeof sourceSchemas]
      expect(schema.safeParse(value).success, name).toBe(true)
    }
    expect(sources.cpu).toMatchObject({ percent: 30, cores: [10, 20] })
    expect(sources.temperatures).toEqual({ cpu: null, gpu: 61.5, fans: [1200] })
    expect(sources.disks?.drives[0]).toMatchObject({ name: 'C:', percent: 80, readPerSecond: 1000 })
    expect(sources.processes?.top[0]).toMatchObject({
      title: 'chrome',
      subtitle: '1.5 GB',
      value: '12%',
    })
    expect(sources.battery).toEqual({ percent: 36, charging: false, minutesLeft: 54 })
    expect(sources.audio).toEqual({ volume: 68, muted: false, device: 'Speakers' })
    expect(sources['active-window']).toEqual({ app: 'Visual Studio Code', title: 'widget.ts' })
    expect(sources.media).toMatchObject({ title: 'Late Night Drive', playing: true })
  })

  it('reads only what was asked, and asks the helper once for widgets reading together', async () => {
    const { helper, calls } = fakeHelper(everything)
    const reader = new SourceReader({ helper })
    await Promise.all([reader.read(['battery']), reader.read(['battery']), reader.read(['audio'])])
    expect(calls.sort()).toEqual(['audio.state', 'power.state'])
    reader.forget('audio')
    await reader.read(['audio'])
    expect(calls.filter((call) => call === 'audio.state')).toHaveLength(2)
  })

  it('reads nothing it cannot, as null rather than a guess', async () => {
    const { helper } = fakeHelper({ 'power.state': { type: 'power', battery: null } })
    const reader = new SourceReader({ helper })
    const sources = await reader.read(['battery', 'audio', 'disks', 'active-window'])
    expect(sources).toEqual({
      battery: { percent: null, charging: null, minutesLeft: null },
      audio: { volume: null, muted: null, device: null },
      disks: { drives: [] },
      'active-window': { app: null, title: null },
    })
  })
})

describe('createCoreMeter', () => {
  it("reports each core's busy share between two readings", () => {
    const times = (idle: number, user: number) =>
      ({ model: '', speed: 0, times: { idle, user, nice: 0, sys: 0, irq: 0 } }) as CpuInfo
    let reading = [times(100, 100), times(100, 100)]
    const meter = createCoreMeter(() => reading)
    expect(meter()).toEqual([])
    reading = [times(150, 150), times(190, 110)]
    expect(meter()).toEqual([50, 10])
  })
})
