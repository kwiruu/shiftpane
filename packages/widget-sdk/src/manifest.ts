/**
 * `manifest.json`: what a widget is and what it is allowed to touch (format v1).
 *
 * Checked when the desktop app installs or loads a widget, and by the marketplace on upload. The
 * JSON Schema in `schema/widget-manifest.schema.json` is generated from this file
 * (`pnpm --filter @shiftpane/widget-sdk schema`) for editors and non-TS tooling.
 */

import { z } from 'zod'

export const categories = [
  'system',
  'dev',
  'productivity',
  'media',
  'finance',
  'weather',
  'fun',
  'other',
] as const
export type Category = (typeof categories)[number]

/** PC data the app reads once and shares with every widget that declares it. */
export const sourceNames = [
  'cpu',
  'memory',
  'gpu',
  'network',
  'disks',
  'battery',
  'audio',
  'system',
  'temperatures',
  'media',
  'processes',
  'active-window',
] as const
export type SourceName = (typeof sourceNames)[number]

/** Buttons on the phone that do something on the PC, from the app's fixed list. */
export const actionNames = [
  'media.play-pause',
  'media.next',
  'media.previous',
  'audio.set-volume',
  'audio.toggle-mute',
] as const
export type ActionName = (typeof actionNames)[number]

/** Small is one board cell, medium two side by side, large two by two. */
export const widgetSizes = ['small', 'medium', 'large'] as const
export type WidgetSize = (typeof widgetSizes)[number]

export interface Permissions {
  sources: SourceName[]
  actions: ActionName[]
  /** Apps on this PC or LAN, exact host:port. */
  local: string[]
  /** Internet hosts the collector may fetch. */
  network: string[]
  secrets: string[]
}

export const NO_PERMISSIONS: Permissions = {
  sources: [],
  actions: [],
  local: [],
  network: [],
  secrets: [],
}

interface ConfigFieldBase {
  key: string
  label: string
  help?: string
  required?: boolean
}

export type ConfigField = ConfigFieldBase &
  (
    | { type: 'string'; default?: string }
    | { type: 'number'; default?: number; min?: number; max?: number }
    | { type: 'boolean'; default?: boolean }
    | { type: 'select'; options: { value: string; label: string }[]; default?: string }
  )

export interface Manifest {
  id: string
  name: string
  description: string
  version: string
  author: string
  license: string
  repository?: string
  categories: Category[]
  minAppVersion: string
  sizes: WidgetSize[]
  /** Seconds between collector runs. */
  refreshSeconds?: number
  permissions: Permissions
  config: ConfigField[]
}

const Kebab = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase-kebab-case')
const SecretName = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'use UPPER_SNAKE_CASE')
const Semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'use semver, e.g. 1.0.0')

/** A bare hostname (`api.github.com`) or one leading wildcard label (`*.example.com`). */
const Host = z
  .string()
  .max(253)
  .regex(
    /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'use a hostname such as api.github.com, without scheme, port or path',
  )

/** An app on this PC or LAN: an exact host and port, such as `127.0.0.1:8085`. */
const LocalHost = z
  .string()
  .max(260)
  .regex(
    /^(?:\[[0-9a-fA-F:]+\]|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?):\d{1,5}$/,
    'use host:port, such as 127.0.0.1:8085',
  )
  .refine((value) => {
    const port = Number(value.slice(value.lastIndexOf(':') + 1))
    return port >= 1 && port <= 65_535
  }, 'the port has to be between 1 and 65535')

const ConfigFieldBase = {
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'use camelCase'),
  label: z.string().min(1).max(64),
  help: z.string().max(256).optional(),
  required: z.boolean().optional(),
}

export const configFieldSchema: z.ZodType<ConfigField> = z.discriminatedUnion('type', [
  z
    .object({ ...ConfigFieldBase, type: z.literal('string'), default: z.string().optional() })
    .strict(),
  z
    .object({
      ...ConfigFieldBase,
      type: z.literal('number'),
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .strict(),
  z
    .object({ ...ConfigFieldBase, type: z.literal('boolean'), default: z.boolean().optional() })
    .strict(),
  z
    .object({
      ...ConfigFieldBase,
      type: z.literal('select'),
      options: z
        .array(z.object({ value: z.string().max(64), label: z.string().max(64) }).strict())
        .min(1)
        .max(32),
      default: z.string().optional(),
    })
    .strict(),
])

export const permissionsSchema = z
  .object({
    sources: z.array(z.enum(sourceNames)).max(sourceNames.length).default([]),
    actions: z.array(z.enum(actionNames)).max(actionNames.length).default([]),
    local: z.array(LocalHost).max(8).default([]),
    network: z.array(Host).max(16).default([]),
    secrets: z.array(SecretName).max(8).default([]),
  })
  .strict()

export const manifestSchema: z.ZodType<Manifest, unknown> = z
  .object({
    $schema: z.string().optional(),
    id: Kebab.max(64),
    name: z.string().min(1).max(48),
    description: z.string().min(1).max(280),
    version: Semver,
    /** The author's GitHub login. */
    author: z.string().min(1).max(64),
    /** An SPDX id; the marketplace holds it against the OSI-approved list. */
    license: z.string().min(1).max(64),
    repository: z
      .url({ protocol: /^https$/ })
      .max(512)
      .optional(),
    categories: z.array(z.enum(categories)).min(1).max(3),
    /** The oldest ShiftPane the widget works with. */
    minAppVersion: Semver,
    sizes: z.array(z.enum(widgetSizes)).min(1).max(widgetSizes.length),
    /** Seconds between collector runs. */
    refreshSeconds: z.number().int().min(1).max(86_400).optional(),
    permissions: permissionsSchema.default(NO_PERMISSIONS),
    config: z.array(configFieldSchema).max(16).default([]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const unique = (path: string, values: readonly string[]) => {
      for (const [index, value] of values.entries()) {
        if (values.indexOf(value) !== index) {
          ctx.addIssue({
            code: 'custom',
            path: path.split('.'),
            message: `"${value}" is listed twice`,
          })
        }
      }
    }
    unique('sizes', manifest.sizes)
    unique('categories', manifest.categories)
    unique(
      'config',
      manifest.config.map((field) => field.key),
    )
    for (const [kind, values] of Object.entries(manifest.permissions)) {
      unique(`permissions.${kind}`, values)
    }
  })

export function parseManifest(json: unknown) {
  return manifestSchema.safeParse(json)
}

/** Whether `host` is allowed by a manifest's `permissions.network` list. */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const target = host.toLowerCase()
  return allowed.some((entry) =>
    entry.startsWith('*.') ? target.endsWith(entry.slice(1)) : target === entry,
  )
}

/** Semver precedence (semver.org, section 11) for the `x.y.z(-pre)` versions a manifest allows. */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = splitPre(a)
  const [coreB = '', preB] = splitPre(b)
  const partsA = coreA.split('.').map(Number)
  const partsB = coreB.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  if (preA === undefined || preB === undefined) {
    // A release outranks its prereleases.
    return preA === preB ? 0 : preA === undefined ? 1 : -1
  }
  const idsA = preA.split('.')
  const idsB = preB.split('.')
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    const idA = idsA[i]
    const idB = idsB[i]
    if (idA === undefined) return -1
    if (idB === undefined) return 1
    const numA = /^\d+$/.test(idA)
    const numB = /^\d+$/.test(idB)
    if (numA && numB) {
      const diff = Number(idA) - Number(idB)
      if (diff !== 0) return Math.sign(diff)
    } else if (numA !== numB) {
      return numA ? -1 : 1
    } else if (idA !== idB) {
      return idA < idB ? -1 : 1
    }
  }
  return 0
}

function splitPre(version: string): [string, string | undefined] {
  const dash = version.indexOf('-')
  return dash === -1 ? [version, undefined] : [version.slice(0, dash), version.slice(dash + 1)]
}
