import { z } from 'zod'
import { categories, permissionsSchema } from './manifest.ts'

/**
 * The marketplace's two files the desktop app reads: `index.json`, every live widget and its
 * approved versions, and `revoked.json`, the versions it must disable. Both are signed (a detached
 * Ed25519 signature in `<name>.sig`) and served from storage, so installing works while the API is
 * down. The app checks the signature against the keys below before reading a byte, and each
 * package against the sha256 the index gives it.
 */

/** Where the site, its API and the registry's files are. */
export const MARKETPLACE_URL = 'https://shiftpane.vercel.app'
export const REGISTRY_URL = `${MARKETPLACE_URL}/registry`
export const API_URL = `${MARKETPLACE_URL}/api/v1`

/**
 * The registry's public keys (base64 SPKI). The app accepts a signature from either, so the key
 * can be rotated: sign with `next`, ship an app that knows it, then make `next` the current one.
 */
export const registryKeys = {
  current: 'MCowBQYDK2VwAyEAj6uP43Nmal1S8BMaKaQ4aEtahnkEwoBrQECaPj3adNo=',
  next: undefined as string | undefined,
}

export const registryPublicKeys: readonly string[] = [
  registryKeys.current,
  registryKeys.next,
].filter((key): key is string => key !== undefined)

const Semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const Id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64)

export const indexVersionSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024),
  url: z.url({ protocol: /^https?$/ }),
  minAppVersion: Semver,
  permissions: permissionsSchema,
})
export type IndexVersion = z.infer<typeof indexVersionSchema>

export const indexEntrySchema = z.object({
  id: Id,
  name: z.string().min(1).max(48),
  summary: z.string().max(280),
  author: z.object({ login: z.string().min(1).max(64) }),
  categories: z.array(z.enum(categories)).max(3),
  latest: Semver,
  versions: z.record(Semver, indexVersionSchema),
})
export type IndexEntry = z.infer<typeof indexEntrySchema>

export const registryIndexSchema = z.object({
  format: z.literal(1),
  generatedAt: z.string(),
  widgets: z.array(indexEntrySchema).max(10_000),
})
export type RegistryIndex = z.infer<typeof registryIndexSchema>

export const revokedListSchema = z.object({
  format: z.literal(1),
  generatedAt: z.string(),
  versions: z
    .array(
      z.object({
        id: Id,
        version: Semver,
        reason: z.string().max(500),
        yankedAt: z.string(),
      }),
    )
    .max(100_000),
})
export type RevokedList = z.infer<typeof revokedListSchema>
