import { placeholderBindings, placeholderConfigKeys, pointer, textsOf } from './bindings.ts'
import { type Manifest, manifestSchema } from './manifest.ts'
import { sources } from './sources.ts'
import {
  sampleSchema,
  type ViewNode,
  viewLimits,
  type WidgetView,
  widgetViewSchema,
} from './view.ts'

/**
 * A widget package: a folder (or, from the marketplace, a zip of one) with fixed file names.
 *
 *   manifest.json   required: what it is and what it may touch
 *   view.json       required: how the phone draws its data
 *   sample.json     required: an example of what the collector returns
 *   collector.js    optional: one ESM file, `export default defineCollector(...)`
 *   README.md, LICENSE, icon.png, screenshots/*.png
 */

export const packageFiles = {
  manifest: 'manifest.json',
  view: 'view.json',
  sample: 'sample.json',
  collector: 'collector.js',
} as const

/** Limits on a package. */
export const packageLimits = {
  totalBytes: 1024 * 1024,
  collectorBytes: 256 * 1024,
  /** The collector's output is capped at 64 KB, so its example is too. */
  sampleBytes: 64 * 1024,
  viewBytes: 64 * 1024,
  manifestBytes: 16 * 1024,
}

/**
 * Ids of the widgets built into ShiftPane. A package can't take one: phones ask the PC for a
 * widget's data by its id, so a package called `pc-stats` would get the built-in one's.
 */
export const reservedIds: readonly string[] = [
  'analog-clock',
  'calendar',
  'clock',
  'cpu',
  'installed',
  'media',
  'memory',
  'network',
  'pc-stats',
]

/** OSI-approved licenses by SPDX id, the ones a widget is likely to use. The marketplace takes these. */
export const osiLicenses = [
  '0BSD',
  'AFL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'Artistic-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSL-1.0',
  'CDDL-1.0',
  'ECL-2.0',
  'EPL-2.0',
  'EUPL-1.2',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'MS-PL',
  'NCSA',
  'OSL-3.0',
  'PostgreSQL',
  'UPL-1.0',
  'Unlicense',
  'Zlib',
]

export interface WidgetPackage {
  manifest: Manifest
  view: WidgetView
  sample: Record<string, unknown>
  /** The collector's source, when the widget has one. */
  collector?: string
}

export type PackageResult = { ok: true; widget: WidgetPackage } | { ok: false; problems: string[] }

/**
 * Reads a package from its files' text, with every check the app makes before it offers to
 * install one: the files parse, the view only binds sources the manifest declares and buttons it
 * declares, and its `/` bindings are in `sample.json`.
 */
export function readPackage(files: {
  manifest?: string
  view?: string
  sample?: string
  collector?: string
}): PackageResult {
  const problems: string[] = []
  const json = (name: string, text: string | undefined, limit: number): unknown => {
    if (text === undefined) {
      problems.push(`${name} is missing.`)
      return undefined
    }
    if (text.length > limit) {
      problems.push(`${name} is over ${Math.round(limit / 1024)} KB.`)
      return undefined
    }
    try {
      return JSON.parse(text)
    } catch (error) {
      problems.push(`${name} isn't valid JSON: ${(error as Error).message}`)
      return undefined
    }
  }

  const manifestJson = json(packageFiles.manifest, files.manifest, packageLimits.manifestBytes)
  const viewJson = json(packageFiles.view, files.view, packageLimits.viewBytes)
  const sampleJson = json(packageFiles.sample, files.sample, packageLimits.sampleBytes)
  if (files.collector !== undefined && files.collector.length > packageLimits.collectorBytes) {
    problems.push(`${packageFiles.collector} is over 256 KB.`)
  }
  if (problems.length > 0) return { ok: false, problems }

  const manifest = manifestSchema.safeParse(manifestJson)
  if (!manifest.success) problems.push(`manifest.json: ${issues(manifest.error)}`)
  const view = widgetViewSchema.safeParse(viewJson)
  if (!view.success) problems.push(`view.json: ${issues(view.error)}`)
  const sample = sampleSchema.safeParse(sampleJson)
  if (!sample.success) problems.push('sample.json has to be a JSON object.')
  if (!manifest.success || !view.success || !sample.success) return { ok: false, problems }

  problems.push(...checkView(manifest.data, view.data, sample.data, files.collector !== undefined))
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    widget: {
      manifest: manifest.data,
      view: view.data,
      sample: sample.data,
      ...(files.collector !== undefined && { collector: files.collector }),
    },
  }
}

/** Problems with a view that parses: what it binds and presses against what the manifest allows. */
export function checkView(
  manifest: Manifest,
  view: WidgetView,
  sample: Record<string, unknown>,
  hasCollector: boolean,
): string[] {
  const problems: string[] = []
  for (const size of Object.keys(view)) {
    if (!(manifest.sizes as string[]).includes(size)) {
      problems.push(`view.json has a ${size} tree, but the manifest doesn't list ${size}.`)
    }
  }
  for (const size of manifest.sizes) {
    if (!view[size]) problems.push(`The manifest lists ${size}, but view.json has no tree for it.`)
  }

  const declared = new Set<string>(manifest.permissions.sources)
  const actions = new Set<string>(manifest.permissions.actions)
  const configKeys = new Set(manifest.config.map((field) => field.key))
  let nodes = 0
  let deepest = 0
  const visit = (node: ViewNode, depth: number) => {
    nodes++
    deepest = Math.max(deepest, depth)
    const texts = textsOf(node)
    const binds = [
      ...('bind' in node && node.bind ? [node.bind] : []),
      ...texts.flatMap(placeholderBindings),
    ]
    for (const bind of binds) {
      if (bind.startsWith('@')) {
        const name = bind.slice(1).split('/')[0] ?? ''
        if (!Object.hasOwn(sources, name)) problems.push(`${bind}: there's no ${name} source.`)
        else if (!declared.has(name)) {
          problems.push(`${bind} reads the ${name} source, which permissions.sources doesn't list.`)
        }
      } else if (!hasCollector) {
        problems.push(`${bind} reads the collector's output, but the package has no collector.js.`)
      } else if (pointer(sample, bind) === undefined) {
        problems.push(`${bind} isn't in sample.json.`)
      }
    }
    if (node.type === 'button' && !actions.has(node.action)) {
      problems.push(`A button presses ${node.action}, which permissions.actions doesn't list.`)
    }
    for (const key of texts.flatMap(placeholderConfigKeys)) {
      if (!configKeys.has(key)) problems.push(`{config.${key}} isn't a config field.`)
    }
    if ('children' in node) for (const child of node.children) visit(child, depth + 1)
  }
  for (const tree of Object.values(view)) if (tree) visit(tree, 1)
  if (deepest > viewLimits.depth) {
    problems.push(`The view nests ${deepest} deep; the limit is ${viewLimits.depth}.`)
  }
  if (nodes > viewLimits.nodes) {
    problems.push(`The view has ${nodes} parts; the limit is ${viewLimits.nodes}.`)
  }
  return [...new Set(problems)]
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 4)
    .map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ')
}
