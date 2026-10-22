import { describe, expect, it } from 'vitest'
import { readPackage } from './package.ts'

const manifest = {
  id: 'gpu-ring',
  name: 'GPU ring',
  description: 'GPU load as a ring, with the last minute below it.',
  version: '1.1.0',
  author: 'shiftpane',
  license: 'MIT',
  categories: ['system'],
  minAppVersion: '0.5.0',
  sizes: ['small', 'medium'],
  permissions: { sources: ['gpu'] },
}

const view = {
  small: {
    type: 'stack',
    children: [
      { type: 'label', text: 'GPU' },
      { type: 'ring', bind: '@gpu/percent' },
    ],
  },
  medium: {
    type: 'row',
    children: [
      { type: 'ring', bind: '@gpu/percent', label: 'GPU' },
      { type: 'history-bars', bind: '@gpu/history' },
    ],
  },
}

const files = (patch: {
  manifest?: object
  view?: object
  sample?: object
  collector?: string
}) => ({
  manifest: JSON.stringify(patch.manifest ?? manifest),
  view: JSON.stringify(patch.view ?? view),
  sample: JSON.stringify(patch.sample ?? {}),
  ...(patch.collector !== undefined && { collector: patch.collector }),
})

describe('readPackage', () => {
  it('reads a bindings-only widget', () => {
    const result = readPackage(files({}))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.widget.manifest.permissions.sources).toEqual(['gpu'])
  })

  it('says which files are missing or broken', () => {
    const result = readPackage({ manifest: '{', view: JSON.stringify(view) })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.problems.some((p) => p.startsWith("manifest.json isn't valid JSON"))).toBe(true)
      expect(result.problems).toContain('sample.json is missing.')
    }
  })

  it('refuses a view that reads a source the manifest does not declare', () => {
    const result = readPackage(files({ manifest: { ...manifest, permissions: { sources: [] } } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toMatch(/@gpu\/percent reads the gpu source/)
  })

  it('refuses a button for an action the manifest does not declare', () => {
    const pressing = {
      small: { type: 'button', action: 'media.next', icon: 'skip-forward', label: 'Next' },
      medium: view.medium,
    }
    const result = readPackage(files({ view: pressing }))
    expect(result.ok).toBe(false)
  })

  it('needs a collector for collector bindings, and the binding in the sample', () => {
    const stars = {
      small: { type: 'value', bind: '/total' },
      medium: { type: 'value', bind: '/total' },
    }
    expect(readPackage(files({ view: stars, sample: { total: 3 } })).ok).toBe(false)
    expect(readPackage(files({ view: stars, sample: {}, collector: 'x' })).ok).toBe(false)
    expect(readPackage(files({ view: stars, sample: { total: 3 }, collector: 'x' })).ok).toBe(true)
  })

  it('wants a tree for every size the manifest lists, and no others', () => {
    expect(readPackage(files({ view: { small: view.small } })).ok).toBe(false)
    expect(readPackage(files({ view: { ...view, large: view.small } })).ok).toBe(false)
  })

  it('refuses an oversized sample', () => {
    const big = { text: 'x'.repeat(70 * 1024) }
    expect(readPackage(files({ sample: big })).ok).toBe(false)
  })
})
