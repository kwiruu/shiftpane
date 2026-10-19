import { SPLIT_PRESETS } from '@shiftpane/layout'
import { SplitName } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SPLIT, parseSplit } from './split.ts'

describe('the default split', () => {
  it('is the widgets alone, with no virtual monitor', () => {
    expect(DEFAULT_SPLIT).toBe('widgets')
    expect(SPLIT_PRESETS[DEFAULT_SPLIT]).toBe(0)
    // What a phone that has never saved a split starts on.
    expect(parseSplit(undefined)).toBe('widgets')
  })
})

describe('parseSplit', () => {
  it('keeps a saved split the phone offers', () => {
    for (const split of Object.keys(SPLIT_PRESETS)) expect(parseSplit(split)).toBe(split)
  })

  it('falls back to the default for anything else', () => {
    for (const saved of [null, 0.5, 70, {}, [], '', '60-40', 'toString', 'constructor']) {
      expect(parseSplit(saved), String(saved)).toBe(DEFAULT_SPLIT)
    }
  })
})

describe('the split names the PC sends', () => {
  it('are exactly the splits the phone offers', () => {
    // The protocol package cannot import the layout package, so this keeps the two in step.
    expect([...SplitName.options].sort()).toEqual(Object.keys(SPLIT_PRESETS).sort())
  })
})
