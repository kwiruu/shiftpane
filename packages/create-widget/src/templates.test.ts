import { readPackage } from '@shiftpane/widget-sdk'
import { describe, expect, it } from 'vitest'
import { idFrom, templates, widgetFiles } from './templates.ts'

describe('widgetFiles', () => {
  it.each(templates)('makes a %s widget the app and the marketplace take as it is', (template) => {
    const files = widgetFiles({
      id: 'my-widget',
      name: 'My widget',
      author: 'octocat',
      template,
      year: 2026,
    })
    const read = readPackage({
      manifest: files['manifest.json'],
      view: files['view.json'],
      sample: files['sample.json'],
      collector: files['collector.js'],
    })
    expect(read).toMatchObject({ ok: true })
    expect(files.LICENSE).toContain('Copyright (c) 2026 octocat')
    expect(files['README.md']).toContain('# My widget')
  })
})

describe('idFrom', () => {
  it('turns a folder or a name into an id', () => {
    expect(idFrom('My Weather_Widget!')).toBe('my-weather-widget')
    expect(idFrom('***')).toBe('my-widget')
  })
})
