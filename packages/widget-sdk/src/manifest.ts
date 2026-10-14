/**
 * `manifest.json`: what a widget is and what it is allowed to touch.
 *
 * Checked on load by the desktop app and in CI for every folder under `widgets/`. The JSON
 * Schema in `schema/widget-manifest.schema.json` is generated from this file
 * (`pnpm --filter @shiftpane/widget-sdk schema`) for editors and non-TS tooling.
 */

import { z } from 'zod'

const Kebab = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase-kebab-case')
const SecretName = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'use UPPER_SNAKE_CASE')

/** A bare hostname (`api.github.com`) or one leading wildcard label (`*.example.com`). */
const Host = z
  .string()
  .max(253)
  .regex(
    /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'use a hostname such as api.github.com, without scheme, port or path',
  )

const ConfigFieldBase = {
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'use camelCase'),
  label: z.string().min(1).max(64),
  help: z.string().max(256).optional(),
  required: z.boolean().default(false),
}

export const ConfigField = z.discriminatedUnion('type', [
  z.object({ ...ConfigFieldBase, type: z.literal('string'), default: z.string().optional() }),
  z.object({
    ...ConfigFieldBase,
    type: z.literal('number'),
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({ ...ConfigFieldBase, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.object({
    ...ConfigFieldBase,
    type: z.literal('select'),
    options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
    default: z.string().optional(),
  }),
])
export type ConfigField = z.infer<typeof ConfigField>

export const WidgetSize = z.enum(['small', 'medium', 'large'])
export type WidgetSize = z.infer<typeof WidgetSize>

export const WidgetManifest = z
  .object({
    $schema: z.string().optional(),
    id: Kebab.max(64),
    name: z.string().min(1).max(48),
    description: z.string().max(280).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'use semver, e.g. 1.0.0'),
    author: z.string().min(1).max(64),
    /** Seconds between collector runs. Omit for widgets that run entirely on the phone. */
    refreshSeconds: z.number().int().min(1).max(86_400).optional(),
    sizes: z.array(WidgetSize).min(1),
    permissions: z
      .object({
        /** Hosts the collector's `fetch` may reach. Everything else is refused. */
        network: z.array(Host).default([]),
        /** Secrets the collector receives. Stored encrypted on the PC, never sent to the phone. */
        secrets: z.array(SecretName).default([]),
      })
      .strict()
      .default({ network: [], secrets: [] }),
    config: z.array(ConfigField).default([]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const keys = manifest.config.map((field) => field.key)
    for (const [index, key] of keys.entries()) {
      if (keys.indexOf(key) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['config', index, 'key'],
          message: `duplicate config key "${key}"`,
        })
      }
    }
  })

export type WidgetManifest = z.infer<typeof WidgetManifest>
export type WidgetManifestInput = z.input<typeof WidgetManifest>

export function parseManifest(json: unknown) {
  return WidgetManifest.safeParse(json)
}

/** Whether `host` is allowed by a manifest's `permissions.network` list. */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const target = host.toLowerCase()
  return allowed.some((entry) =>
    entry.startsWith('*.') ? target.endsWith(entry.slice(1)) : target === entry,
  )
}
