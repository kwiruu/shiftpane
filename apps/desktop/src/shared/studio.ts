/**
 * Widget Studio's recipes: a widget made without code, as a name, the sizes it comes in and up to
 * four blocks, each one PC reading shown one way ("GPU load as a ring"). Studio edits recipes and
 * the generator writes them; the app turns a recipe into an ordinary widget package, with a layout
 * for each size built from the same view nodes as the first-party widgets. A recipe can't say
 * anything a view couldn't, so whatever a model writes into one is checked here and drawn by the
 * app's own components.
 */

import {
  type Accent,
  accents,
  type Category,
  describePermissions,
  type SourceName,
  type ValueFormat,
  type ViewNode,
  type WidgetSize,
  type WidgetView,
  widgetSizes,
} from '@shiftpane/widget-sdk'
import { z } from 'zod'

type Kind = 'percent' | 'bytes' | 'rate' | 'celsius' | 'duration' | 'text' | 'list'

interface Metric {
  /** What it's called in Studio's picker. */
  title: string
  /** The short label a card shows. */
  label: string
  source: SourceName
  bind: string
  kind: Kind
  /** A minute of readings, for bars and lines. */
  history?: string
}

/** Every PC reading a recipe can show, by id. */
export const metrics = {
  cpu: {
    title: 'CPU load',
    label: 'CPU',
    source: 'cpu',
    bind: '@cpu/percent',
    kind: 'percent',
    history: '@cpu/history',
  },
  gpu: {
    title: 'GPU load',
    label: 'GPU',
    source: 'gpu',
    bind: '@gpu/percent',
    kind: 'percent',
    history: '@gpu/history',
  },
  memory: {
    title: 'Memory in use',
    label: 'RAM',
    source: 'memory',
    bind: '@memory/percent',
    kind: 'percent',
    history: '@memory/history',
  },
  'memory-used': {
    title: 'Memory used',
    label: 'RAM',
    source: 'memory',
    bind: '@memory/used',
    kind: 'bytes',
  },
  download: {
    title: 'Download speed',
    label: 'Down',
    source: 'network',
    bind: '@network/receivedPerSecond',
    kind: 'rate',
    history: '@network/history',
  },
  upload: {
    title: 'Upload speed',
    label: 'Up',
    source: 'network',
    bind: '@network/sentPerSecond',
    kind: 'rate',
  },
  disk: {
    title: 'Main drive used',
    label: 'Disk',
    source: 'disks',
    bind: '@disks/drives/0/percent',
    kind: 'percent',
  },
  battery: {
    title: 'Battery charge',
    label: 'Battery',
    source: 'battery',
    bind: '@battery/percent',
    kind: 'percent',
  },
  volume: {
    title: 'Volume',
    label: 'Volume',
    source: 'audio',
    bind: '@audio/volume',
    kind: 'percent',
  },
  'cpu-temp': {
    title: 'CPU temperature',
    label: 'CPU',
    source: 'temperatures',
    bind: '@temperatures/cpu',
    kind: 'celsius',
  },
  'gpu-temp': {
    title: 'GPU temperature',
    label: 'GPU',
    source: 'temperatures',
    bind: '@temperatures/gpu',
    kind: 'celsius',
  },
  uptime: {
    title: 'Time since start',
    label: 'Up for',
    source: 'system',
    bind: '@system/uptimeSeconds',
    kind: 'duration',
  },
  track: {
    title: 'Track playing',
    label: 'Playing',
    source: 'media',
    bind: '@media/title',
    kind: 'text',
  },
  artist: {
    title: 'Artist playing',
    label: 'Artist',
    source: 'media',
    bind: '@media/artist',
    kind: 'text',
  },
  'top-apps': {
    title: 'Busiest programs',
    label: 'Busiest',
    source: 'processes',
    bind: '@processes/top',
    kind: 'list',
  },
  window: {
    title: 'App in front',
    label: 'In front',
    source: 'active-window',
    bind: '@active-window/app',
    kind: 'text',
  },
} as const satisfies Record<string, Metric>

export type MetricId = keyof typeof metrics
export const metricIds = Object.keys(metrics) as MetricId[]

/** How a block shows its reading. */
export const shows = ['ring', 'value', 'bars', 'line', 'meter', 'bar', 'text', 'list'] as const
export type Show = (typeof shows)[number]

/** What Studio's picker calls each way of showing a reading. */
export const showTitles: Record<Show, string> = {
  ring: 'Ring',
  value: 'Big number',
  bars: 'Bars, last minute',
  line: 'Line, last minute',
  meter: 'Meter',
  bar: 'Thin bar',
  text: 'Text',
  list: 'List',
}

const FORMATS: Partial<Record<Kind, ValueFormat>> = {
  percent: 'percent',
  bytes: 'bytes',
  rate: 'rate',
  celsius: 'celsius',
  duration: 'duration',
}

/** The ways a reading can be shown: rings and meters need a percent, charts need history. */
export function showsFor(id: MetricId): Show[] {
  const metric: Metric = metrics[id]
  if (metric.kind === 'text') return ['text']
  if (metric.kind === 'list') return ['list']
  const charts: Show[] = metric.history ? ['bars', 'line'] : []
  if (metric.kind === 'percent') return ['ring', 'value', 'meter', 'bar', ...charts]
  if (metric.kind === 'celsius') return ['value', 'meter', ...charts]
  return ['value', ...charts]
}

export const MAX_BLOCKS = 4

const Label = z.string().trim().max(24)

export const blockSchema = z.object({
  show: z.enum(metricIds as [MetricId, ...MetricId[]]),
  as: z.enum(shows),
  /** The card's label for it; the reading's own when empty. */
  label: Label.optional(),
  color: z.enum(accents).optional(),
})
export type Block = z.infer<typeof blockSchema>

export const recipeSchema = z.object({
  name: z.string().trim().min(1).max(48),
  description: z.string().trim().max(280).optional(),
  sizes: z.array(z.enum(widgetSizes)).min(1).max(widgetSizes.length),
  blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS),
})
export type Recipe = z.infer<typeof recipeSchema>

/** A new recipe: the GPU as a ring, small and medium. */
export function newRecipe(): Recipe {
  return {
    name: 'My widget',
    sizes: ['small', 'medium'],
    blocks: [{ show: 'gpu', as: 'ring', color: 'flame' }],
  }
}

/**
 * Makes a recipe a model (or an old save) wrote usable: unknown readings and duplicate sizes are
 * dropped, and a block shown a way its reading can't be gets the first way it can. Null when
 * nothing usable is left.
 */
export function repairRecipe(input: unknown): Recipe | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .map((entry): Block | null => {
      const block = entry as Record<string, unknown>
      if (typeof block?.show !== 'string' || !(block.show in metrics)) return null
      const show = block.show as MetricId
      const allowed = showsFor(show)
      const as = allowed.includes(block.as as Show) ? (block.as as Show) : (allowed[0] ?? 'value')
      const label = typeof block.label === 'string' ? block.label.trim().slice(0, 24) : undefined
      const color = accents.includes(block.color as Accent) ? (block.color as Accent) : undefined
      return { show, as, ...(label ? { label } : {}), ...(color ? { color } : {}) }
    })
    .filter((block): block is Block => block !== null)
    .slice(0, MAX_BLOCKS)
  if (blocks.length === 0) return null
  const sizes = widgetSizes.filter(
    (size) => Array.isArray(raw.sizes) && (raw.sizes as unknown[]).includes(size),
  )
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 48) : ''
  const description =
    typeof raw.description === 'string' ? raw.description.trim().slice(0, 280) : ''
  return {
    name: name || titleOf(blocks),
    ...(description ? { description } : {}),
    sizes: sizes.length > 0 ? sizes : ['small', 'medium'],
    blocks,
  }
}

const titleOf = (blocks: Block[]) =>
  blocks.map((block) => metrics[block.show].label).join(' and ') || 'My widget'

// ---------------------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------------------

const labelOf = (block: Block) => block.label || metrics[block.show].label

function valueNode(block: Block, size: 'sm' | 'md' | 'lg' | 'xl'): ViewNode {
  const metric: Metric = metrics[block.show]
  const format = FORMATS[metric.kind]
  return { type: 'value', bind: metric.bind, ...(format ? { format } : {}), size }
}

/** A label with the reading beside it, for a row among others. */
const headed = (block: Block, size: 'sm' | 'md' = 'md'): ViewNode => ({
  type: 'row',
  align: 'between',
  children: [{ type: 'label', text: labelOf(block) }, valueNode(block, size)],
})

/** A block filling the card, or its half of one. */
function hero(block: Block, listMax: number): ViewNode {
  const metric: Metric = metrics[block.show]
  const label = labelOf(block)
  switch (block.as) {
    case 'ring':
      return {
        type: 'ring',
        bind: metric.bind,
        label,
        ...(block.color ? { color: block.color } : {}),
      }
    case 'bars':
      return {
        type: 'stack',
        align: 'between',
        children: [headed(block), { type: 'history-bars', bind: metric.history ?? metric.bind }],
      }
    case 'line':
      return {
        type: 'stack',
        align: 'between',
        children: [
          headed(block),
          {
            type: 'sparkline',
            bind: metric.history ?? metric.bind,
            ...(block.color ? { color: block.color } : {}),
          },
        ],
      }
    case 'meter':
      return {
        type: 'stack',
        align: 'between',
        children: [headed(block), { type: 'meter', bind: metric.bind }],
      }
    case 'bar':
      return {
        type: 'stack',
        align: 'between',
        children: [
          { type: 'label', text: label },
          valueNode(block, 'xl'),
          { type: 'progress', bind: metric.bind, ...(block.color ? { color: block.color } : {}) },
        ],
      }
    case 'text':
      return {
        type: 'stack',
        align: 'between',
        children: [
          { type: 'label', text: label },
          { type: 'text', bind: metric.bind, size: 'lg' },
        ],
      }
    case 'list':
      return {
        type: 'stack',
        gap: 3,
        children: [
          { type: 'label', text: label },
          { type: 'list', bind: metric.bind, max: listMax },
        ],
      }
    case 'value':
      return {
        type: 'stack',
        align: 'between',
        children: [{ type: 'label', text: label }, valueNode(block, 'xl')],
      }
  }
}

/**
 * A block as one line among others: its label and reading, and a bar under a percent. Type scales
 * with the card, so a large card's lines take the smaller figure.
 */
function compact(block: Block, size: 'sm' | 'md' = 'md'): ViewNode {
  const metric: Metric = metrics[block.show]
  if (block.as === 'text') {
    return {
      type: 'stack',
      gap: 1,
      children: [
        { type: 'label', text: labelOf(block) },
        { type: 'text', bind: metric.bind, size: 'sm' },
      ],
    }
  }
  if (block.as === 'list') {
    return {
      type: 'stack',
      gap: 2,
      children: [
        { type: 'label', text: labelOf(block) },
        { type: 'list', bind: metric.bind, max: 3 },
      ],
    }
  }
  if (metric.kind === 'percent' || block.as === 'meter') {
    return {
      type: 'stack',
      gap: 2,
      children: [
        headed(block, size),
        block.as === 'meter'
          ? { type: 'meter', bind: metric.bind }
          : { type: 'progress', bind: metric.bind, ...(block.color ? { color: block.color } : {}) },
      ],
    }
  }
  return headed(block, size)
}

/** The minute behind a reading, when it has one and the block isn't a chart already. */
function history(block: Block): ViewNode | null {
  const metric: Metric = metrics[block.show]
  if (!metric.history || block.as === 'bars' || block.as === 'line') return null
  return {
    type: 'stack',
    align: 'between',
    children: [
      { type: 'label', text: 'Last minute' },
      { type: 'history-bars', bind: metric.history },
    ],
  }
}

const ring = (block: Block): ViewNode => ({
  type: 'ring',
  bind: metrics[block.show].bind,
  ...(block.color ? { color: block.color } : {}),
})

function small(blocks: Block[]): ViewNode {
  const [first, second] = blocks
  if (!first) return { type: 'stack', children: [] }
  // Two plain readings share a small card, a line each; anything bigger gets it to itself.
  const plain = (block: Block) => ['value', 'meter', 'bar'].includes(block.as)
  if (second && plain(first) && plain(second)) {
    return { type: 'stack', align: 'between', children: [compact(first), compact(second)] }
  }
  return first.as === 'ring'
    ? {
        type: 'stack',
        align: 'between',
        children: [{ type: 'label', text: labelOf(first) }, ring(first)],
      }
    : hero(first, 3)
}

/** Two rings first: they lead the card side by side, as "CPU and GPU as two rings" means. */
function pairedRings(blocks: Block[]): [Block, Block, Block[]] | null {
  const [first, second, ...rest] = blocks
  return first?.as === 'ring' && second?.as === 'ring' ? [first, second, rest] : null
}

function medium(blocks: Block[]): ViewNode {
  // Two rings fill a medium card on their own; the large card has room for the rest.
  const paired = pairedRings(blocks)
  if (paired) return { type: 'row', gap: 5, children: [hero(paired[0], 3), hero(paired[1], 3)] }
  const [first, ...rest] = blocks
  if (!first) return { type: 'stack', children: [] }
  const side: ViewNode | null =
    rest.length > 0
      ? {
          type: 'stack',
          align: 'between',
          children: rest.slice(0, 3).map((block) => compact(block)),
        }
      : history(first)
  if (!side) return hero(first, 3)
  return { type: 'row', gap: 5, children: [hero(first, 3), side] }
}

function large(blocks: Block[]): ViewNode {
  const paired = pairedRings(blocks)
  if (paired) {
    const [a, b, rest] = paired
    const rings: ViewNode = { type: 'row', gap: 5, children: [hero(a, 4), hero(b, 4)] }
    if (rest.length === 0) return rings
    const below: ViewNode = {
      type: 'grid',
      columns: rest.length === 1 ? 1 : 2,
      gap: 4,
      children: rest.map((block) => compact(block, 'sm')),
    }
    return {
      type: 'stack',
      align: 'between',
      gap: 4,
      children: [rings, { type: 'divider' }, below],
    }
  }
  const [first, ...rest] = blocks
  if (!first) return { type: 'stack', children: [] }
  const below: ViewNode | null =
    rest.length > 0
      ? {
          type: 'grid',
          columns: rest.length === 1 ? 1 : 2,
          gap: 4,
          children: rest.map((block) => compact(block, 'sm')),
        }
      : history(first)
  if (!below) return hero(first, 6)
  return {
    type: 'stack',
    align: 'between',
    gap: 4,
    children: [hero(first, 4), { type: 'divider' }, below],
  }
}

/** The recipe's view: a layout for each size it comes in. */
export function buildView(recipe: Recipe): WidgetView {
  const builders: Record<WidgetSize, (blocks: Block[]) => ViewNode> = { small, medium, large }
  return Object.fromEntries(
    widgetSizes
      .filter((size) => recipe.sizes.includes(size))
      .map((size) => [size, builders[size](recipe.blocks)]),
  )
}

// ---------------------------------------------------------------------------------------
// The package
// ---------------------------------------------------------------------------------------

/** The sources a recipe reads, in the order its blocks name them. */
export function sourcesOf(recipe: Recipe): SourceName[] {
  const wanted = new Set(recipe.blocks.map((block) => metrics[block.show].source as SourceName))
  return [...wanted]
}

/** A widget id from its name: lowercase words joined by dashes. */
export function idFromName(name: string): string {
  const id = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return id || 'my-widget'
}

const describe = (recipe: Recipe) =>
  recipe.description ||
  `${recipe.blocks.map((block) => metrics[block.show].title).join(', ')}, made in Widget Studio.`

function categoryOf(recipe: Recipe): Category {
  const sources = sourcesOf(recipe)
  return sources.every((source) => source === 'media' || source === 'audio') ? 'media' : 'system'
}

/**
 * The files of the widget a recipe makes: an ordinary package with no collector, so it runs
 * nothing on the PC and reads only the sources its blocks name.
 */
export function buildFiles(
  recipe: Recipe,
  options: { id: string; version: string; author: string; appVersion: string; year: number },
): Record<string, string> {
  const permissions = {
    sources: sourcesOf(recipe),
    actions: [],
    local: [],
    network: [],
    secrets: [],
  }
  const manifest = {
    id: options.id,
    name: recipe.name,
    description: describe(recipe),
    version: options.version,
    author: options.author,
    license: 'MIT',
    categories: [categoryOf(recipe)],
    minAppVersion: options.appVersion,
    sizes: widgetSizes.filter((size) => recipe.sizes.includes(size)),
    permissions,
  }
  const lines = describePermissions(permissions).map((line) => `- ${line.text}.`)
  const readme = `# ${recipe.name}

${describe(recipe)}

Made in ShiftPane's Widget Studio: it has no code, only a layout bound to the PC readings below.

## Permissions

${lines.join('\n')}
`
  const license = `MIT License

Copyright (c) ${options.year} ${options.author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
  return {
    'manifest.json': json(manifest),
    'view.json': json(buildView(recipe)),
    'sample.json': json({}),
    'README.md': readme,
    LICENSE: license,
  }
}
