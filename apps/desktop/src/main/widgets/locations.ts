import { locationSchema } from '@shiftpane/widget-sdk'
import { z } from 'zod'
import type { InstalledInfo, LocationSearchResult } from '../../shared/widgets.ts'

export function canSearchLocations(
  fromMain: boolean,
  widget: Pick<InstalledInfo, 'config' | 'permissions'> | undefined,
): boolean {
  return (
    fromMain &&
    !!widget?.config.fields.some((field) => field.type === 'location') &&
    widget.permissions.some(
      (permission) =>
        permission.kind === 'network' && permission.value === 'geocoding-api.open-meteo.com',
    )
  )
}

const querySchema = z.string().trim().min(2).max(120)
const responseSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        admin1: z.string().optional(),
        country: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string(),
      }),
    )
    .max(10)
    .optional(),
})

/** Fixed provider only; caller checks the main-window sender and installed widget permissions. */
export class LocationSearch {
  #pending = new Map<string, AbortController>()
  #request: typeof fetch
  constructor(request: typeof fetch = fetch) {
    this.#request = request
  }

  cancel(id: string): void {
    this.#pending.get(id)?.abort()
    this.#pending.delete(id)
  }

  async search(id: string, query: unknown): Promise<LocationSearchResult> {
    this.cancel(id)
    const parsed = querySchema.safeParse(query)
    if (!parsed.success) return { locations: [], problem: 'Enter 2–120 characters.' }
    const controller = new AbortController()
    this.#pending.set(id, controller)
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
      url.search = new URLSearchParams({
        name: parsed.data,
        count: '10',
        language: 'en',
        format: 'json',
      }).toString()
      const response = await this.#request(url, { signal: controller.signal, redirect: 'error' })
      if (!response.ok) throw new Error('Provider unavailable')
      const body = responseSchema.parse(await response.json())
      const locations = (body.results ?? []).flatMap((city) => {
        const result = locationSchema.safeParse({
          label: [...new Set([city.name, city.admin1, city.country].filter(Boolean))].join(', '),
          latitude: city.latitude,
          longitude: city.longitude,
          timezone: city.timezone,
        })
        return result.success ? [result.data] : []
      })
      if (controller.signal.aborted)
        return { locations: [], problem: 'Search canceled. Try again.' }
      return { locations, problem: null }
    } catch {
      return {
        locations: [],
        problem: 'Could not search cities. Check your connection and try again.',
      }
    } finally {
      clearTimeout(timeout)
      if (this.#pending.get(id) === controller) this.#pending.delete(id)
    }
  }
}
