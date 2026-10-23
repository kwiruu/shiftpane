import { describe, expect, it } from 'vitest'
import { configDefaults } from './bindings.ts'
import { checkConfig, parseLocation, validDatetime } from './config.ts'
import { configFieldSchema } from './manifest.ts'
import { widgetViewSchema } from './view.ts'

const city = {
  label: 'Manila, Metro Manila, Philippines',
  latitude: 14.6,
  longitude: 120.98,
  timezone: 'Asia/Manila',
}
describe('location and datetime settings', () => {
  it('round-trips selected cities as primitive strings and rejects invalid coordinates or timezone', () => {
    const fields = [configFieldSchema.parse({ key: 'city', label: 'City', type: 'location' })]
    const stored = checkConfig(fields, { city: JSON.stringify(city) })
    expect(stored.problems).toEqual([])
    expect(parseLocation(stored.config.city)).toEqual(city)
    for (const invalid of [
      { ...city, latitude: 91 },
      { ...city, longitude: -181 },
      { ...city, timezone: 'invalid' },
    ]) {
      expect(checkConfig(fields, { city: JSON.stringify(invalid) }).problems).toHaveLength(1)
    }
    expect(parseLocation('{bad')).toBeNull()
    expect(parseLocation('Manila')).toBeNull()
  })
  it('requires an explicit timezone and rejects normalized impossible dates', () => {
    expect(validDatetime('2026-11-05T09:00:00+08:00')).toBe(true)
    for (const value of ['2026-11-05T09:00', '2026-02-30T09:00:00Z', 'nope', 123])
      expect(validDatetime(value)).toBe(false)
    expect(
      checkConfig([{ type: 'datetime', key: 'target', label: 'Target' }], { target: 'bad' })
        .problems,
    ).toHaveLength(1)
  })
  it('keeps existing primitive field defaults and validation', () => {
    const fields = [
      configFieldSchema.parse({
        key: 'units',
        label: 'Units',
        type: 'select',
        options: [{ value: 'c', label: 'Celsius' }],
        default: 'c',
      }),
      configFieldSchema.parse({ key: 'city', label: 'City', type: 'location' }),
    ]
    expect(configDefaults(fields)).toEqual({ units: 'c' })
    expect(checkConfig(fields, { units: 'c', extra: true })).toEqual({
      config: { units: 'c' },
      problems: [],
    })
  })
  it('allows bound icons with a required static fallback', () => {
    expect(
      widgetViewSchema.safeParse({ small: { type: 'icon', name: 'cloud', bind: '/icon' } }).success,
    ).toBe(true)
    expect(widgetViewSchema.safeParse({ small: { type: 'icon', bind: '/icon' } }).success).toBe(
      false,
    )
  })
})
