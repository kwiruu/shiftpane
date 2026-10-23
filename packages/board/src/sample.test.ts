import { describe, expect, it } from 'vitest'
import { SampleFeed, type SampleInstalled } from './sample.ts'

const widget = (id: string, name: string): SampleInstalled => ({
  id,
  name,
  version: '1.0.0',
  sizes: ['small'],
  actions: [],
  view: { small: { type: 'value', bind: '@cpu/percent' } },
  sample: {},
  config: {},
  sources: ['cpu'],
})

describe('SampleFeed', () => {
  it('previews drafts beside the installed widgets, a draft standing in for one with its id', () => {
    const feed = new SampleFeed()
    feed.showInstalled([widget('gpu-ring', 'GPU ring'), widget('pc-busy', 'Is my PC busy?')])
    feed.showDrafts([widget('pc-busy', 'Busy, edited'), widget('studio-draft', 'New one')])

    const { installed, widgets } = feed.store.getState()
    expect(installed.map((item) => item.name)).toEqual(['GPU ring', 'Busy, edited', 'New one'])
    // A draft gets the sample PC's readings for the sources it reads, like an installed widget.
    expect(widgets['studio-draft']?.data.sources).toHaveProperty('cpu')

    feed.showDrafts([])
    expect(feed.store.getState().installed.map((item) => item.name)).toEqual([
      'GPU ring',
      'Is my PC busy?',
    ])
  })
})
