import { describe, expect, it, vi } from 'vitest'
import { canSearchLocations, LocationSearch } from './locations.ts'

const result = (results?: unknown[]) =>
  new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } })
const city = { name: 'Paris', latitude: 48.8, longitude: 2.3, timezone: 'Europe/Paris' }

describe('city search', () => {
  it('requires a main-window sender, an installed location field and the exact declared provider host', () => {
    const widget = {
      config: {
        fields: [{ key: 'location', label: 'City', type: 'location' as const }],
        values: {},
      },
      permissions: [
        { kind: 'network' as const, value: 'geocoding-api.open-meteo.com', text: '', asks: false },
      ],
    }
    expect(canSearchLocations(true, widget)).toBe(true)
    expect(canSearchLocations(false, widget)).toBe(false)
    expect(canSearchLocations(true, undefined)).toBe(false)
    expect(canSearchLocations(true, { ...widget, permissions: [] })).toBe(false)
    expect(canSearchLocations(true, { ...widget, config: { fields: [], values: {} } })).toBe(false)
  })
  it('keeps city qualifiers and uses only the fixed endpoint with encoded queries', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      result([
        { ...city, admin1: 'Île-de-France', country: 'France' },
        {
          ...city,
          latitude: 33.6,
          longitude: -95.5,
          admin1: 'Texas',
          country: 'United States',
          timezone: 'America/Chicago',
        },
      ]),
    )
    const search = new LocationSearch(request)
    const answer = await search.search('weather', 'Paris, France&count=100')
    expect(answer.locations.map((item) => item.label)).toEqual([
      'Paris, Île-de-France, France',
      'Paris, Texas, United States',
    ])
    const url = new URL(String(request.mock.calls[0]?.[0]))
    expect(url.origin).toBe('https://geocoding-api.open-meteo.com')
    expect(url.searchParams.get('name')).toBe('Paris, France&count=100')
    expect(url.searchParams.get('count')).toBe('10')
    expect(request.mock.calls[0]?.[1]?.redirect).toBe('error')
  })
  it('handles no matches, malformed input, invalid data and provider failures', async () => {
    const request = vi.fn<typeof fetch>(async () => result())
    const search = new LocationSearch(request)
    expect(await search.search('weather', 'Nowhere')).toEqual({ locations: [], problem: null })
    expect((await search.search('weather', 'a')).problem).toBeTruthy()
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce(result([{ ...city, latitude: 100 }]))
    expect((await search.search('weather', 'Paris')).locations).toEqual([])
    request.mockRejectedValueOnce(new Error('offline'))
    expect((await search.search('weather', 'Paris')).problem).toMatch(/Could not search/)
    request.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect((await search.search('weather', 'Paris')).problem).toBeTruthy()
  })
  it('aborts superseded searches and explicit cancellation', async () => {
    const signals: AbortSignal[] = []
    const request = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    )
    const search = new LocationSearch(request)
    const first = search.search('weather', 'Paris')
    const second = search.search('weather', 'Manila')
    expect(signals[0]?.aborted).toBe(true)
    search.cancel('weather')
    expect(signals[1]?.aborted).toBe(true)
    await Promise.all([first, second])
  })
})
