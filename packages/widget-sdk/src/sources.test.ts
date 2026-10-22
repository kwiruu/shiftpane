import { describe, expect, it } from 'vitest'
import { sampleSources, sourceSchemas } from './sources.ts'

describe('the sample PC', () => {
  it('is shaped like every source the app sends', () => {
    for (const [name, schema] of Object.entries(sourceSchemas)) {
      const parsed = schema.safeParse(sampleSources[name as keyof typeof sampleSources])
      expect(parsed.success, name).toBe(true)
    }
  })
})

describe('the registry contract', () => {
  it("reads the live index's shape", async () => {
    const { registryIndexSchema, revokedListSchema } = await import('./registry.ts')
    const entry = {
      id: 'github-stars',
      name: 'GitHub stars',
      summary: 'Stars across your repositories.',
      author: { login: 'shiftpane' },
      categories: ['dev'],
      latest: '1.1.1',
      versions: {
        '1.1.1': {
          sha256: '19c496d247b621c7cd1a8072560e50b408cc11f25eb7c01fa98904f81884cf6e',
          size: 3332,
          minAppVersion: '0.5.0',
          permissions: {
            local: [],
            actions: [],
            network: ['api.github.com'],
            secrets: ['GITHUB_TOKEN'],
            sources: [],
          },
          url: 'https://shiftpane.vercel.app/registry/packages/19c496d247b621c7cd1a8072560e50b408cc11f25eb7c01fa98904f81884cf6e.zip',
        },
      },
    }
    expect(
      registryIndexSchema.safeParse({ format: 1, generatedAt: 'x', widgets: [entry] }).success,
    ).toBe(true)
    expect(revokedListSchema.safeParse({ format: 1, generatedAt: 'x', versions: [] }).success).toBe(
      true,
    )
    const tampered = {
      ...entry,
      versions: { '1.1.1': { ...entry.versions['1.1.1'], url: 'file:///C:/x' } },
    }
    expect(
      registryIndexSchema.safeParse({ format: 1, generatedAt: 'x', widgets: [tampered] }).success,
    ).toBe(false)
  })
})
