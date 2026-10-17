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
    expect(store.getState()).toEqual({ pcStats: null, history: [], media: null, monitors: [] })
  })
})
