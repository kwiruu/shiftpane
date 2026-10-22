import { describe, expect, it, vi } from 'vitest'
import { HISTORY_LENGTH, PcDataStore } from './data.ts'

const stats = {
  cpuPercent: 34,
  memory: { usedBytes: 8e9, totalBytes: 16e9 },
  gpuPercent: null,
  network: null,
}

describe('PcDataStore', () => {
  it('keeps the latest PC stats and media, and tells listeners', () => {
    const store = new PcDataStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.handle({
      type: 'widget.update',
      instanceId: 'pc-stats',
      widgetId: 'pc-stats',
      data: stats,
      at: 5,
    })
    expect(store.getState().pcStats).toEqual({ data: stats, at: 5 })
    expect(store.getState().history).toEqual([
      { cpu: 34, gpu: null, memory: 50, down: null, up: null },
    ])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps only the most recent stats for the charts', () => {
    const store = new PcDataStore()
    for (let at = 0; at < HISTORY_LENGTH + 5; at += 1) {
      store.handle({
        type: 'widget.update',
        instanceId: 'pc-stats',
        widgetId: 'pc-stats',
        data: { ...stats, cpuPercent: at % 100 },
        at,
      })
    }
    const { history } = store.getState()
    expect(history).toHaveLength(HISTORY_LENGTH)
    expect(history.at(-1)?.cpu).toBe((HISTORY_LENGTH + 4) % 100)
  })

  it('drops widget data that does not match the widget schema', () => {
    const store = new PcDataStore()
    store.handle({
      type: 'widget.update',
      instanceId: 'pc-stats',
      widgetId: 'pc-stats',
      data: { cpuPercent: 'lots' },
      at: 1,
    })
    store.handle({ type: 'widget.update', instanceId: 'x', widgetId: 'unknown', data: 1, at: 1 })
    expect(store.getState().pcStats).toBeNull()
  })

  it('keeps the monitor list and forgets everything on reset', () => {
    const store = new PcDataStore()
    const monitors = [{ id: '1', name: 'Mi Monitor', width: 1920, height: 1080, primary: true }]
    store.handle({ type: 'monitors', monitors })
    expect(store.getState().monitors).toEqual(monitors)
    store.reset()
    expect(store.getState()).toEqual({
      pcStats: null,
      history: [],
      media: null,
      monitors: [],
      installed: [],
      widgets: {},
    })
  })
})

describe('installed widgets', () => {
  const gpuRing = {
    id: 'gpu-ring',
    name: 'GPU ring',
    version: '1.1.0',
    sizes: ['small' as const],
    actions: [],
    view: { small: { type: 'ring' as const, bind: '@gpu/percent' } },
  }
  const data = {
    sources: { gpu: { percent: 40, history: [] } },
    output: {},
    config: {},
    problem: null,
  }

  it("keeps what the PC has installed and each one's latest data", () => {
    const store = new PcDataStore()
    store.handle({ type: 'widgets.installed', widgets: [gpuRing] })
    store.handle({
      type: 'widget.update',
      instanceId: 'gpu-ring',
      widgetId: 'gpu-ring',
      data,
      at: 9,
    })
    expect(store.getState().installed).toEqual([gpuRing])
    expect(store.getState().widgets['gpu-ring']).toEqual({ data, at: 9 })
  })

  it("drops data that is not shaped like an installed widget's", () => {
    const store = new PcDataStore()
    store.handle({
      type: 'widget.update',
      instanceId: 'gpu-ring',
      widgetId: 'gpu-ring',
      data: { percent: 40 },
      at: 1,
    })
    expect(store.getState().widgets).toEqual({})
  })

  it('forgets the data but not the widgets when the connection drops', () => {
    const store = new PcDataStore()
    store.handle({ type: 'widgets.installed', widgets: [gpuRing] })
    store.handle({
      type: 'widget.update',
      instanceId: 'gpu-ring',
      widgetId: 'gpu-ring',
      data,
      at: 9,
    })
    store.reset()
    expect(store.getState().installed).toEqual([gpuRing])
    expect(store.getState().widgets).toEqual({})
  })
})
