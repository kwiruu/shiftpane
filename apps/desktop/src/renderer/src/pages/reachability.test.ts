import { describe, expect, it } from 'vitest'
import { SILENCE_HINT_MS, showSilenceHint } from './reachability.ts'

const quiet = {
  diagnostics: { pageAt: null, testAt: null, socketAt: null },
  phones: [],
  watchingSince: 1_000,
}

describe('showSilenceHint', () => {
  it('waits for the silence to last before suggesting anything', () => {
    expect(showSilenceHint(quiet, 1_000 + SILENCE_HINT_MS - 1)).toBe(false)
    expect(showSilenceHint(quiet, 1_000 + SILENCE_HINT_MS)).toBe(true)
  })

  it('stays quiet once another device has requested the page, the test or the socket', () => {
    for (const stage of ['pageAt', 'testAt', 'socketAt'] as const) {
      const state = { ...quiet, diagnostics: { ...quiet.diagnostics, [stage]: 5_000 } }
      expect(showSilenceHint(state, 1_000_000)).toBe(false)
    }
  })

  it('stays quiet while a phone is connected', () => {
    const phones = [{}] as never
    expect(showSilenceHint({ ...quiet, phones }, 1_000_000)).toBe(false)
  })
})
