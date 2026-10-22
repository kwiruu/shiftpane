import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compareVersions, isHostAllowed, manifestSchema, parseManifest } from './manifest.ts'

const github = {
  id: 'github-stars',
  name: 'GitHub stars',
  description: 'Stars across your repositories, and the ones with the most.',
  version: '1.1.1',
  author: 'shiftpane',
  license: 'MIT',
  categories: ['dev'],
  minAppVersion: '0.5.0',
  sizes: ['small', 'medium', 'large'],
  refreshSeconds: 900,
  permissions: { network: ['api.github.com'], secrets: ['GITHUB_TOKEN'] },
  config: [{ key: 'owner', type: 'string', label: 'User or organization', required: true }],
}

describe('widget manifest', () => {
  it('accepts a marketplace manifest and fills in the permissions it leaves out', () => {
    const result = parseManifest(github)
    expect(result.success).toBe(true)
    expect(result.data?.permissions).toEqual({
      sources: [],
      actions: [],
      local: [],
      network: ['api.github.com'],
      secrets: ['GITHUB_TOKEN'],
    })
  })

  it('defaults permissions and config to nothing', () => {
    const { permissions: _, config: __, ...rest } = github
    const parsed = parseManifest(rest).data
    expect(parsed?.permissions.sources).toEqual([])
    expect(parsed?.config).toEqual([])
  })

  it.each([
    ['uppercase id', { id: 'GitHub' }],
    ['URL instead of host', { permissions: { network: ['https://api.github.com/users'] } }],
    ['lowercase secret', { permissions: { secrets: ['github_token'] } }],
    ['unknown source', { permissions: { sources: ['keyboard'] } }],
    ['local without a port', { permissions: { local: ['127.0.0.1'] } }],
    ['local port out of range', { permissions: { local: ['127.0.0.1:70000'] } }],
    ['refresh of zero', { refreshSeconds: 0 }],
    ['no sizes', { sizes: [] }],
    ['no categories', { categories: [] }],
    ['not semver', { version: 'v1' }],
    ['http repository', { repository: 'http://example.com/repo' }],
    ['unknown field', { runAsAdmin: true }],
    ['unknown permission', { permissions: { filesystem: ['C:\\'] } }],
  ])('rejects %s', (_label, patch) => {
    expect(parseManifest({ ...github, ...patch }).success).toBe(false)
  })

  it('rejects anything listed twice', () => {
    const field = { key: 'owner', type: 'string', label: 'User' } as const
    expect(parseManifest({ ...github, config: [field, field] }).success).toBe(false)
    expect(parseManifest({ ...github, sizes: ['small', 'small'] }).success).toBe(false)
    expect(
      parseManifest({ ...github, permissions: { network: ['api.github.com', 'api.github.com'] } })
        .success,
    ).toBe(false)
  })

  it('keeps the generated JSON Schema in sync', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../schema/widget-manifest.schema.json', import.meta.url), 'utf8'),
    )
    const fresh = z.toJSONSchema(manifestSchema, { io: 'input', unrepresentable: 'any' })
    expect(committed).toEqual({ ...fresh, title: 'ShiftPane widget manifest' })
  })
})

describe('isHostAllowed', () => {
  it('matches exact hosts and one wildcard label, ignoring case', () => {
    expect(isHostAllowed('api.github.com', ['api.github.com'])).toBe(true)
    expect(isHostAllowed('API.GitHub.com', ['api.github.com'])).toBe(true)
    expect(isHostAllowed('eu.api.example.com', ['*.example.com'])).toBe(true)
  })

  it('refuses look-alikes', () => {
    expect(isHostAllowed('github.com', ['api.github.com'])).toBe(false)
    expect(isHostAllowed('api.github.com.evil.io', ['api.github.com'])).toBe(false)
    expect(isHostAllowed('example.com', ['*.example.com'])).toBe(false)
    expect(isHostAllowed('badexample.com', ['*.example.com'])).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders by semver precedence', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
  })
})
