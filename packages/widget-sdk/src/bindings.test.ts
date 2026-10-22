import { describe, expect, it } from 'vitest'

import {
  bindingsOf,
  configDefaults,
  formatValue,
  interpolate,
  placeholderBindings,
  placeholderConfigKeys,
  pointer,
  resolveBinding,
  viewFor,
} from './bindings.ts'
import type { WidgetView } from './view.ts'

describe('pointer', () => {
  const doc = { a: { 'b/c': [10, 20], 'm~n': true } }

  it('walks objects and arrays', () => {
    expect(pointer(doc, '/a/b~1c/1')).toBe(20)
  })

  it('unescapes ~0 and ~1 in that order', () => {
    expect(pointer(doc, '/a/m~0n')).toBe(true)
  })

  it('returns the root for an empty pointer', () => {
    expect(pointer(doc, '')).toBe(doc)
  })

  it('returns undefined for missing steps and non-pointers', () => {
    expect(pointer(doc, '/a/x/y')).toBeUndefined()
    expect(pointer(doc, 'a')).toBeUndefined()
  })
})

describe('resolveBinding', () => {
  const context = {
    sample: { stars: 1200, repos: [{ name: 'shiftpane' }] },
    sources: { gpu: { percent: 64, history: [1, 2, 3] } },
  }

  it('reads a system source with @name/path', () => {
    expect(resolveBinding('@gpu/percent', context)).toBe(64)
    expect(resolveBinding('@gpu/history', context)).toEqual([1, 2, 3])
  })

  it('returns the whole source for @name', () => {
    expect(resolveBinding('@gpu', context)).toEqual(context.sources.gpu)
  })

  it('reads collector output with a JSON Pointer', () => {
    expect(resolveBinding('/repos/0/name', context)).toBe('shiftpane')
  })

  it('does not reach sources the context lacks', () => {
    expect(resolveBinding('@media/title', context)).toBeUndefined()
  })
})

describe('interpolate', () => {
  it('inserts config values and blanks missing ones', () => {
    expect(
      interpolate('Over {config.threshold}% {config.nope}', {
        sample: {},
        config: { threshold: 80 },
      }),
    ).toBe('Over 80% ')
  })

  it('inserts bound values: a source, or the collector output', () => {
    const context = {
      sample: { status: 'All clear', nested: { n: 3 } },
      sources: { media: { app: 'Spotify' } },
      config: {},
    }
    expect(interpolate('Playing on {@media/app}', context)).toBe('Playing on Spotify')
    expect(interpolate('{/status}: {/nested/n} left', context)).toBe('All clear: 3 left')
    // Objects and anything missing become empty text rather than "[object Object]".
    expect(interpolate('[{/nested}] [{/nope}] [{@media/nope}]', context)).toBe('[] [] []')
  })

  it('leaves braces that are not placeholders alone', () => {
    expect(interpolate('{ not a placeholder } {config}', { sample: {} })).toBe(
      '{ not a placeholder } {config}',
    )
  })
})

describe('placeholders', () => {
  it('lists the bindings and config keys a text inserts', () => {
    const text = 'Over {config.threshold} on {@media/app} / {/status}'
    expect(placeholderBindings(text)).toEqual(['@media/app', '/status'])
    expect(placeholderConfigKeys(text)).toEqual(['threshold'])
  })
})

describe('configDefaults', () => {
  it('collects defaults, skipping fields without one', () => {
    expect(
      configDefaults([
        { key: 'threshold', label: 'Threshold', type: 'number', default: 80 },
        { key: 'repo', label: 'Repository', type: 'string' },
      ]),
    ).toEqual({ threshold: 80 })
  })
})

describe('bindingsOf and viewFor', () => {
  const view: WidgetView = {
    small: { type: 'ring', bind: '@gpu/percent' },
    large: {
      type: 'stack',
      children: [
        { type: 'label', text: 'GPU' },
        { type: 'history-bars', bind: '@gpu/history' },
        { type: 'row', children: [{ type: 'value', bind: '/stars' }] },
      ],
    },
  }

  it('finds every binding, nested ones included', () => {
    expect(bindingsOf(view).sort()).toEqual(['/stars', '@gpu/history', '@gpu/percent'])
  })

  it('finds the bindings inserted into text too', () => {
    const playing: WidgetView = {
      small: {
        type: 'row',
        children: [
          { type: 'equalizer' },
          { type: 'text', text: 'Playing on {@media/app}', size: 'xs' },
          { type: 'cover', bind: '@media/title', icon: 'music' },
          { type: 'button', action: 'media.next', icon: 'skip-forward', label: 'Next {/n}' },
        ],
      },
    }
    expect(bindingsOf(playing).sort()).toEqual(['/n', '@media/app', '@media/title'])
  })

  it('falls back to the nearest size', () => {
    expect(viewFor(view, 'medium')).toBe(view.small)
    expect(viewFor(view, 'large')).toBe(view.large)
  })
})

describe('formatValue', () => {
  it('rounds and clamps percentages', () => {
    expect(formatValue(64.6, 'percent')).toEqual({ value: '65', unit: '%' })
    expect(formatValue(140, 'percent')).toEqual({ value: '100', unit: '%' })
  })

  it('scales bytes and rates', () => {
    expect(formatValue(4.2 * 1024 ** 2, 'rate')).toEqual({ value: '4.2', unit: 'MB/s' })
    expect(formatValue(512, 'bytes')).toEqual({ value: '512', unit: 'B' })
    expect(formatValue(19.7 * 1024 ** 3, 'bytes')).toEqual({ value: '20', unit: 'GB' })
  })

  it('keeps the degree sign with the number', () => {
    expect(formatValue(61.4, 'celsius')).toEqual({ value: '61°', unit: 'C' })
  })

  it('shortens large counts', () => {
    expect(formatValue(1234, 'compact')).toEqual({ value: '1.2k', unit: undefined })
    expect(formatValue(48_200, 'compact')).toEqual({ value: '48k', unit: undefined })
  })

  it('formats durations from seconds', () => {
    expect(formatValue(600, 'duration')).toEqual({ value: '10', unit: 'm' })
    expect(formatValue(3 * 86_400, 'duration')).toEqual({ value: '3', unit: 'd' })
  })

  it('shows a dash for missing numbers and passes strings through', () => {
    expect(formatValue(undefined)).toEqual({ value: '—', unit: undefined })
    expect(formatValue('idle')).toEqual({ value: 'idle', unit: undefined })
  })
})

describe('bindings stay inside the data', () => {
  it('does not walk into prototypes', () => {
    expect(pointer({}, '/constructor')).toBeUndefined()
    expect(pointer({ a: {} }, '/a/__proto__')).toBeUndefined()
    expect(pointer([1, 2], '/1')).toBe(2)
  })

  it('reads no source the context was not given', () => {
    expect(resolveBinding('@gpu/percent', { sample: {} })).toBeUndefined()
    expect(resolveBinding('@toString', { sample: {}, sources: {} })).toBeUndefined()
  })
})
