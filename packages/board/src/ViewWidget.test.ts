import { describe, expect, it } from 'vitest'
import { sizeForBox } from './ViewWidget.tsx'

describe('sizeForBox', () => {
  it('draws a wide card as the medium tree', () => {
    expect(sizeForBox({ width: 320, height: 150 })).toBe('medium')
  })

  it('draws a big squarish card as the large tree, and anything smaller as the small one', () => {
    expect(sizeForBox({ width: 330, height: 300 })).toBe('large')
    expect(sizeForBox({ width: 150, height: 150 })).toBe('small')
    expect(sizeForBox({ width: 150, height: 320 })).toBe('small')
  })
})
