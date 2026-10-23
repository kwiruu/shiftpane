import { expect, it } from 'vitest'
import { viewNodeSchema } from './view.ts'

it('accepts a bounded contribution calendar node and rejects unsupported values', () => {
  expect(
    viewNodeSchema.safeParse({
      type: 'contribution-calendar',
      bind: '/calendar',
      weeks: 26,
      split: false,
    }).success,
  ).toBe(true)
  for (const weeks of [0, 55, 1.5])
    expect(
      viewNodeSchema.safeParse({ type: 'contribution-calendar', bind: '/calendar', weeks }).success,
    ).toBe(false)
})
