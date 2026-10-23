import type { ConfigField, SourceName, WidgetSize } from './manifest.ts'
import type { ValueFormat, ViewNode, WidgetView } from './view.ts'

/**
 * How a view reads its data: `@name/...` reads a system source, `/...` reads the collector's
 * output as a JSON Pointer, and `{config.key}` in text inserts a config value. Pure functions, so
 * the phone, the desktop window, the gallery and the marketplace's checks all agree.
 */

export interface BindingContext {
  /** The collector's output, or the widget's `sample.json` in a preview. */
  sample: Record<string, unknown>
  /** System sources by name: the PC's own on a phone, the sample PC in a preview. */
  sources?: Partial<Record<SourceName, unknown>>
  config?: Record<string, unknown>
}

/** JSON Pointer (RFC 6901) lookup. `undefined` when any step is missing. */
export function pointer(root: unknown, path: string): unknown {
  if (path === '' || path === '/') return root
  if (!path.startsWith('/')) return undefined
  let current: unknown = root
  for (const raw of path.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** The value a `bind` names, or `undefined` if it doesn't resolve. */
export function resolveBinding(bind: string, context: BindingContext): unknown {
  if (bind.startsWith('@')) {
    const slash = bind.indexOf('/')
    const name = slash === -1 ? bind.slice(1) : bind.slice(1, slash)
    const sources = context.sources ?? {}
    if (!Object.hasOwn(sources, name)) return undefined
    const source = sources[name as SourceName]
    return slash === -1 ? source : pointer(source, bind.slice(slash))
  }
  return pointer(context.sample, bind)
}

/** `{config.key}`, `{@source/path}` or `{/pointer}` inside text. */
const placeholder = /\{(config\.[a-zA-Z][a-zA-Z0-9]*|[@/][^{}\s]*)\}/g

/**
 * Replaces each `{config.key}` with the config value, and each `{@source/path}` or `{/pointer}`
 * with the value it binds. Anything that doesn't resolve becomes empty text.
 */
export function interpolate(text: string, context: BindingContext): string {
  return text.replace(placeholder, (_, inner: string) => {
    const value = inner.startsWith('config.')
      ? context.config?.[inner.slice('config.'.length)]
      : resolveBinding(inner, context)
    return value === undefined || value === null || typeof value === 'object' ? '' : String(value)
  })
}

/** The bindings a piece of text inserts: `@media/app` for "Playing on {@media/app}". */
export function placeholderBindings(text: string): string[] {
  return [...text.matchAll(placeholder)].flatMap(([, inner]) =>
    inner && !inner.startsWith('config.') ? [inner] : [],
  )
}

/** The config keys a piece of text inserts. */
export function placeholderConfigKeys(text: string): string[] {
  return [...text.matchAll(placeholder)].flatMap(([, inner]) =>
    inner?.startsWith('config.') ? [inner.slice('config.'.length)] : [],
  )
}

/** The text a node shows that can hold placeholders: its label, caption or words. */
export function textsOf(node: ViewNode): string[] {
  switch (node.type) {
    case 'value':
      return node.unit ? [node.unit] : []
    case 'label':
      return [node.text]
    case 'text':
      return node.text ? [node.text] : []
    case 'ring':
      return node.label ? [node.label] : []
    case 'button':
      return [node.label]
    default:
      return []
  }
}

/** Each config field's default, as the app fills them in before the first run. */
export function configDefaults(fields: ConfigField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      'default' in field && field.default !== undefined ? [[field.key, field.default]] : [],
    ),
  )
}

/** Every binding a view uses, in `bind` fields and inserted into text, for the checks and the permission summary. */
export function bindingsOf(view: WidgetView): string[] {
  const found = new Set<string>()
  const walk = (node: ViewNode | undefined) => {
    if (!node) return
    if ('bind' in node && typeof node.bind === 'string') found.add(node.bind)
    for (const text of textsOf(node)) for (const bind of placeholderBindings(text)) found.add(bind)
    if ('children' in node) node.children.forEach(walk)
  }
  Object.values(view).forEach(walk)
  return [...found]
}

/** The tree for a size, falling back to the nearest size the widget does have. */
export function viewFor(view: WidgetView, size: WidgetSize): ViewNode | undefined {
  const order: Record<WidgetSize, WidgetSize[]> = {
    small: ['small', 'medium', 'large'],
    medium: ['medium', 'small', 'large'],
    large: ['large', 'medium', 'small'],
  }
  for (const candidate of order[size]) {
    const node = view[candidate]
    if (node) return node
  }
  return undefined
}

export interface Formatted {
  value: string
  unit?: string
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** A number as the board shows it: a big figure and a small unit after it. */
export function formatValue(
  input: unknown,
  format: ValueFormat = 'number',
  unit?: string,
): Formatted {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { value: typeof input === 'string' ? input : '—', unit }
  }
  switch (format) {
    case 'percent':
      return { value: String(Math.round(Math.min(100, Math.max(0, input)))), unit: unit ?? '%' }
    case 'celsius':
      return { value: `${Math.round(input)}°`, unit: unit ?? 'C' }
    case 'compact':
      return compact(input, unit)
    case 'bytes':
    case 'rate': {
      let value = Math.abs(input)
      let step = 0
      while (value >= 1024 && step < BYTE_UNITS.length - 1) {
        value /= 1024
        step++
      }
      const digits = value < 10 && step > 0 ? 1 : 0
      const base = BYTE_UNITS[step] ?? 'B'
      return {
        value: (Math.sign(input) * value).toFixed(digits),
        unit: format === 'rate' ? `${base}/s` : base,
      }
    }
    case 'duration': {
      const minutes = Math.round(input / 60)
      if (minutes < 60) return { value: String(minutes), unit: 'm' }
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return { value: `${hours}h ${minutes % 60}`, unit: 'm' }
      return { value: String(Math.floor(hours / 24)), unit: 'd' }
    }
    default:
      return { value: input.toLocaleString('en-US'), unit }
  }
}

function compact(input: number, unit?: string): Formatted {
  const abs = Math.abs(input)
  if (abs < 1000) return { value: String(Math.round(input)), unit }
  const [divisor, suffix] = abs < 1_000_000 ? [1000, 'k'] : [1_000_000, 'M']
  const scaled = input / divisor
  return { value: `${scaled.toFixed(Math.abs(scaled) < 10 ? 1 : 0)}${suffix}`, unit }
}
