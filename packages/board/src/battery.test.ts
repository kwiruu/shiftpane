import { expect, it } from 'vitest'
import { batteryState } from './battery.ts'

it('fills five segments proportionally without rounding the reading', () => {
  expect(batteryState({ percent: 0 }).segments).toEqual([0, 0, 0, 0, 0])
  expect(batteryState({ percent: 52 }).segments).toEqual([1, 1, 0.6000000000000001, 0, 0])
  expect(batteryState({ percent: 100 }).segments).toEqual([1, 1, 1, 1, 1])
})
it('distinguishes missing data and handles charging and estimates', () => {
  expect(batteryState(null)).toMatchObject({
    percent: null,
    caption: 'Battery unavailable',
    segments: [0, 0, 0, 0, 0],
  })
  expect(batteryState({ percent: NaN }).percent).toBeNull()
  expect(batteryState({ percent: 52, charging: true, minutesLeft: 120 }).caption).toBe('Charging')
  expect(batteryState({ percent: 100, charging: true }).caption).toBe('Fully charged')
  expect(batteryState({ percent: 52, minutesLeft: 120 }).caption).toBe('~ 2 hours')
  expect(batteryState({ percent: 52, minutesLeft: 65 }).caption).toBe('~ 1 hour 5 min')
  expect(batteryState({ percent: 52, minutesLeft: 30 }).caption).toBe('~ 30 min')
  expect(batteryState({ percent: 52, minutesLeft: null }).caption).toBe('')
  expect(batteryState({ percent: 52, minutesLeft: -1 }).caption).toBe('')
})
