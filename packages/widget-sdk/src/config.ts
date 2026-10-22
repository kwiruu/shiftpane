import type { ConfigField } from './manifest.ts'

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
