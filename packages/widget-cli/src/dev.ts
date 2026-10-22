import { guardedFetch, type HostFetch, runCollector } from '@shiftpane/widget-runtime'
import {
  bindingsOf,
  type ConfigField,
  checkConfig,
  configDefaults,
  pickSources,
  pointer,
  sampleSources,
  type WidgetPackage,
} from '@shiftpane/widget-sdk'

/**
 * Turns `--config key=value` pairs into values of each field's type, then checks them like the
 * app does. Defaults fill in what isn't given.
 */
export function configFromArgs(
  fields: ConfigField[],
  pairs: string[],
): { config: Record<string, unknown>; problems: string[] } {
  const given: Record<string, unknown> = {}
  const problems: string[] = []
  for (const pair of pairs) {
    const at = pair.indexOf('=')
    const key = at === -1 ? pair : pair.slice(0, at)
    const raw = at === -1 ? '' : pair.slice(at + 1)
    const field = fields.find((candidate) => candidate.key === key)
    if (!field) {
      problems.push(`There is no config field "${key}".`)
      continue
    }
    given[key] =
      field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'true' : raw
  }
  const checked = checkConfig(fields, given)
  return {
    config: { ...configDefaults(fields), ...checked.config },
    problems: [...problems, ...checked.problems],
  }
}

export interface DevRun {
  ok: boolean
  /** What the collector returned, or `{}` for a widget without one. */
  output?: Record<string, unknown>
  error?: string
  /** `/` bindings in the view the output doesn't have. */
  missing: string[]
  /** Required config with no value. */
  unset: string[]
  ms: number
}

/**
 * Runs a widget's collector once, as the app would: in the sandbox, with the guarded fetch, its
 * config, the secrets it declares (read from environment variables of the same names) and the
 * sample PC for its sources.
 */
export async function runOnce(
  widget: WidgetPackage,
  config: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  fetch: HostFetch = guardedFetch(widget.manifest.permissions),
): Promise<DevRun> {
  const { manifest, collector, view } = widget
  const unset = manifest.config
    .filter((field) => field.required && config[field.key] === undefined)
    .map((field) => field.key)
  const started = Date.now()
  let output: Record<string, unknown> = {}
  if (collector !== undefined && unset.length === 0) {
    const secrets: Record<string, string> = {}
    for (const name of manifest.permissions.secrets) {
      const value = env[name]
      if (value) secrets[name] = value
    }
    const result = await runCollector({
      code: collector,
      config,
      secrets,
      sources: pickSources(sampleSources, manifest.permissions.sources),
      fetch,
      log: (message) => console.info(`  collector: ${message}`),
    })
    if (!result.ok)
      return { ok: false, error: result.error, missing: [], unset, ms: Date.now() - started }
    output = result.output
  }
  const missing =
    collector === undefined || unset.length > 0
      ? []
      : bindingsOf(view).filter(
          (bind) => bind.startsWith('/') && pointer(output, bind) === undefined,
        )
  return { ok: unset.length === 0, output, missing, unset, ms: Date.now() - started }
}
