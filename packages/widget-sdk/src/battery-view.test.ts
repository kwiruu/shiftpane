import { expect, it } from 'vitest'
import { manifestSchema } from './manifest.ts'
import { checkView } from './package.ts'
import { viewNodeSchema } from './view.ts'

it('accepts a battery object binding and requires its permission', () => {
  const node = { type: 'battery-gauge', bind: '@battery' } as const
  expect(viewNodeSchema.safeParse(node).success).toBe(true)
  expect(viewNodeSchema.safeParse({ type: 'battery-gauge' }).success).toBe(false)
  const manifest = manifestSchema.parse({
    id: 'laptop-battery',
    name: 'Laptop Battery',
    description: 'Battery',
    version: '1.0.0',
    author: 'shiftpane',
    license: 'MIT',
    categories: ['system'],
    minAppVersion: '0.6.0',
    sizes: ['small', 'medium'],
    permissions: { sources: ['battery'], actions: [], local: [], network: [], secrets: [] },
    config: [],
  })
  expect(checkView(manifest, { small: node, medium: node }, {}, false)).toEqual([])
  expect(
    checkView(
      { ...manifest, permissions: { ...manifest.permissions, sources: [] } },
      { small: node, medium: node },
      {},
      false,
    ).length,
  ).toBeGreaterThan(0)
})
