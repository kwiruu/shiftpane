import { z } from 'zod'
import type { ConfigField } from './manifest.ts'

/** A selected city, stored as JSON text to preserve primitive config values. */
export const locationSchema = z
  .object({
    label: z.string().min(1).max(200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      }, 'Choose a valid timezone.'),
  })
  .strict()
export type WidgetLocation = z.infer<typeof locationSchema>

export function parseLocation(value: unknown): WidgetLocation | null {
  if (typeof value !== 'string' || value.length > 1024) return null
  try {
    const parsed = locationSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Require an explicit offset; never reinterpret a saved target in a new timezone. */
export function validDatetime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return (
    z.iso.datetime({ offset: true }).safeParse(value).success && Number.isFinite(Date.parse(value))
  )
}

/** A config value as the user set it. */
export type ConfigValues = Record<string, string | number | boolean>

/**
 * Checks config values against a widget's fields: the right type, within a number's range, one
 * of a select's options. Values for fields the widget doesn't have are dropped; a field without a
 * value is left out (a required one is asked for before the collector runs).
 */
export function checkConfig(
  fields: ConfigField[],
  values: Record<string, unknown>,
): { config: ConfigValues; problems: string[] } {
  const config: ConfigValues = {}
  const problems: string[] = []
  for (const field of fields) {
    if (!Object.hasOwn(values, field.key)) continue
    const value = values[field.key]
    if (value === undefined || value === null || value === '') continue
    switch (field.type) {
      case 'location': {
        const location = parseLocation(value)
        if (location) config[field.key] = JSON.stringify(location)
        else problems.push(`${field.label} has to be a selected city.`)
        break
      }
      case 'datetime':
        if (validDatetime(value)) config[field.key] = value
        else problems.push(`${field.label} has to be a valid date and time with a timezone.`)
        break
      case 'string':
        if (typeof value === 'string' && value.length <= 512) config[field.key] = value.trim()
        else problems.push(`${field.label} has to be text.`)
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          problems.push(`${field.label} has to be a number.`)
        } else if (
          (field.min !== undefined && value < field.min) ||
          (field.max !== undefined && value > field.max)
        ) {
          problems.push(
            `${field.label} has to be between ${field.min ?? '-∞'} and ${field.max ?? '∞'}.`,
          )
        } else {
          config[field.key] = value
        }
        break
      case 'boolean':
        if (typeof value === 'boolean') config[field.key] = value
        else problems.push(`${field.label} has to be on or off.`)
        break
      case 'select':
        if (typeof value === 'string' && field.options.some((option) => option.value === value)) {
          config[field.key] = value
        } else {
          problems.push(`${field.label} has to be one of its options.`)
        }
        break
    }
  }
  return { config, problems }
}
