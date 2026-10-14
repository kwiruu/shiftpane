import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  isHostAllowed,
  parseManifest,
  WidgetManifest,
  type WidgetManifestInput,
} from './manifest.ts'

const github: WidgetManifestInput = {
  id: 'github-stats',
  name: 'GitHub stats',
  version: '1.0.0',
  author: 'your-github-handle',
  refreshSeconds: 300,
  sizes: ['small', 'medium'],
  permissions: { network: ['api.github.com'], secrets: ['GITHUB_TOKEN'] },
  config: [{ key: 'username', type: 'string', label: 'GitHub username' }],
}

describe('widget manifest', () => {
  it('accepts the example from the plan and fills defaults', () => {
    const result = parseManifest(github)
    expect(result.success).toBe(true)
    expect(result.data?.config[0]?.required).toBe(false)
  })

  it('defaults permissions to nothing', () => {
    const { permissions: _, ...rest } = github
    expect(parseManifest(rest).data?.permissions).toEqual({ network: [], secrets: [] })
  })

  it.each([
    ['uppercase id', { id: 'GitHub' }],
    ['URL instead of host', { permissions: { network: ['https://api.github.com/users'] } }],
    ['lowercase secret', { permissions: { secrets: ['github_token'] } }],
    ['refresh of zero', { refreshSeconds: 0 }],
    ['no sizes', { sizes: [] }],
    ['not semver', { version: 'v1' }],
    ['unknown field', { runAsAdmin: true }],
    ['unknown permission', { permissions: { filesystem: ['C:\\'] } }],
  ])('rejects %s', (_label, patch) => {
    expect(parseManifest({ ...github, ...patch }).success).toBe(false)
  })

  it('rejects duplicate config keys', () => {
    const field = { key: 'username', type: 'string', label: 'User' } as const
    expect(parseManifest({ ...github, config: [field, field] }).success).toBe(false)
  })

  it('keeps the generated JSON Schema in sync', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../schema/widget-manifest.schema.json', import.meta.url), 'utf8'),
    )
    const fresh = z.toJSONSchema(WidgetManifest, { io: 'input', unrepresentable: 'any' })
    expect(committed).toEqual({ ...fresh, title: 'ShiftPane widget manifest' })
  })
})

describe('isHostAllowed', () => {
  it('matches exact hosts and single wildcards, case-insensitively', () => {
    expect(isHostAllowed('api.github.com', ['api.github.com'])).toBe(true)
    expect(isHostAllowed('API.GitHub.com', ['api.github.com'])).toBe(true)
    expect(isHostAllowed('evil.com', ['api.github.com'])).toBe(false)
    expect(isHostAllowed('api.github.com.evil.com', ['api.github.com'])).toBe(false)
    expect(isHostAllowed('eu.api.example.com', ['*.example.com'])).toBe(true)
    expect(isHostAllowed('example.com', ['*.example.com'])).toBe(false)
    expect(isHostAllowed('notexample.com', ['*.example.com'])).toBe(false)
  })
})
