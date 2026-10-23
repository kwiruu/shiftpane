import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkFolder } from '@shiftpane/widget-runtime'
import {
  resolveBinding,
  sampleSources,
  type ViewNode,
  widgetSizes,
  widgetViewSchema,
} from '@shiftpane/widget-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFiles,
  buildView,
  idFromName,
  metricIds,
  type Recipe,
  repairRecipe,
  showsFor,
  sourcesOf,
} from '../../shared/studio.ts'

const binds = (node: ViewNode): string[] => {
  const own = 'bind' in node && node.bind ? [node.bind] : []
  const children = 'children' in node ? node.children.flatMap(binds) : []
  return [...own, ...children]
}

const options = {
  id: 'my-widget',
  version: '0.1.0',
  author: 'kwiruu',
  appVersion: '0.5.0',
  year: 2026,
}

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('buildView', () => {
  it('lays out every reading, shown every way it can be, at every size', () => {
    for (const show of metricIds) {
      for (const as of showsFor(show)) {
        for (const extra of [[], [{ show: 'cpu' as const, as: 'value' as const }]]) {
          const recipe: Recipe = {
            name: 'Test',
            sizes: [...widgetSizes],
            blocks: [{ show, as }, ...extra],
          }
          const view = buildView(recipe)
          expect(widgetViewSchema.safeParse(view).success, `${show} as ${as}`).toBe(true)
          for (const node of Object.values(view)) {
            for (const bind of binds(node)) {
              // Every binding reads something on the sample PC, so previews are never empty.
              expect(resolveBinding(bind, { sample: {}, sources: sampleSources }), bind).not.toBe(
                undefined,
              )
            }
          }
        }
      }
    }
  })

  it('gives each size its own layout, and only the sizes asked for', () => {
    const view = buildView({
      name: 'GPU',
      sizes: ['small', 'medium'],
      blocks: [{ show: 'gpu', as: 'ring' }],
    })
    expect(Object.keys(view)).toEqual(['small', 'medium'])
    // Medium puts the last minute beside the ring, as the first-party GPU ring does.
    expect(view.medium).toMatchObject({
      type: 'row',
      children: [
        { type: 'ring' },
        {
          type: 'stack',
          children: [{ type: 'label' }, { type: 'history-bars', bind: '@gpu/history' }],
        },
      ],
    })
  })

  it('puts two leading rings side by side, the rest under them when there is room', () => {
    const view = buildView({
      name: 'CPU and GPU',
      sizes: ['medium', 'large'],
      blocks: [
        { show: 'cpu', as: 'ring' },
        { show: 'gpu', as: 'ring' },
        { show: 'download', as: 'bars' },
      ],
    })
    // Two rings fill a medium card on their own.
    expect(view.medium).toEqual({
      type: 'row',
      gap: 5,
      children: [
        { type: 'ring', bind: '@cpu/percent', label: 'CPU' },
        { type: 'ring', bind: '@gpu/percent', label: 'GPU' },
      ],
    })
    expect(view.large).toMatchObject({
      type: 'stack',
      children: [{ type: 'row' }, { type: 'divider' }, { type: 'grid' }],
    })
  })
})

describe('buildFiles', () => {
  it('makes a package that passes every check the marketplace runs here', async () => {
    const recipe: Recipe = {
      name: 'CPU and GPU',
      sizes: ['small', 'medium', 'large'],
      blocks: [
        { show: 'cpu', as: 'ring', color: 'flame' },
        { show: 'gpu', as: 'bar' },
        { show: 'download', as: 'value' },
      ],
    }
    const folder = await mkdtemp(join(tmpdir(), 'shiftpane-studio-'))
    dir = folder
    for (const [name, text] of Object.entries(buildFiles(recipe, options))) {
      await writeFile(join(folder, name), text)
    }
    const report = await checkFolder(folder)
    expect(report.problems).toEqual([])
    expect(report.widget?.manifest).toMatchObject({
      id: 'my-widget',
      name: 'CPU and GPU',
      permissions: { sources: ['cpu', 'gpu', 'network'], network: [], local: [] },
    })
    expect(report.widget?.collector).toBeUndefined()
  })

  it('reads only the sources its blocks name', () => {
    expect(
      sourcesOf({
        name: 'x',
        sizes: ['small'],
        blocks: [
          { show: 'track', as: 'text' },
          { show: 'artist', as: 'text' },
        ],
      }),
    ).toEqual(['media'])
  })
})

describe('repairRecipe', () => {
  it('keeps what makes sense from what a model wrote, and fixes the rest', () => {
    expect(
      repairRecipe({
        name: '  Busy PC  ',
        sizes: ['huge', 'small', 'small'],
        blocks: [
          { show: 'cpu', as: 'ring', color: 'flame', label: 'Processor' },
          { show: 'track', as: 'ring' },
          { show: 'weather', as: 'value' },
          { show: 'memory', as: 'value', color: 'purple' },
        ],
      }),
    ).toEqual({
      name: 'Busy PC',
      sizes: ['small'],
      blocks: [
        { show: 'cpu', as: 'ring', color: 'flame', label: 'Processor' },
        { show: 'track', as: 'text' },
        { show: 'memory', as: 'value' },
      ],
    })
  })

  it('names an unnamed widget after its readings, and gives up on nothing usable', () => {
    expect(repairRecipe({ blocks: [{ show: 'gpu', as: 'bars' }] })).toMatchObject({
      name: 'GPU',
      sizes: ['small', 'medium'],
    })
    expect(repairRecipe({ name: 'Nothing', blocks: [{ show: 'stocks', as: 'value' }] })).toBeNull()
    expect(repairRecipe('a widget')).toBeNull()
  })
})

describe('idFromName', () => {
  it('makes a kebab-case id', () => {
    expect(idFromName('Is my PC busy?')).toBe('is-my-pc-busy')
    expect(idFromName('  Café — CPU  ')).toBe('cafe-cpu')
    expect(idFromName('!!!')).toBe('my-widget')
  })
})
