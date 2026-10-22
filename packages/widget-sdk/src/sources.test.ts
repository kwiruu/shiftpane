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
