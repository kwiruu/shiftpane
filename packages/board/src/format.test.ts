import { describe, expect, it } from 'vitest'
import { bytesParts, formatBytes, formatPercent, formatRate, rateParts } from './format.ts'

describe('format', () => {
  it('formats bytes with short units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(16 * 1024 ** 3)).toBe('16 GB')
    expect(formatBytes(7.5 * 1024 ** 3)).toBe('7.5 GB')
    expect(formatBytes(-5)).toBe('0 B')
  })

  it('formats rates and percentages', () => {
    expect(formatRate(2.5 * 1024 * 1024)).toBe('2.5 MB/s')
    expect(formatPercent(33.6)).toBe('34%')
    expect(formatPercent(120)).toBe('100%')
  })

  it('splits a number from its unit', () => {
    expect(bytesParts(7.5 * 1024 ** 3)).toEqual({ value: '7.5', unit: 'GB' })
    expect(rateParts(2.5 * 1024 * 1024)).toEqual({ value: '2.5', unit: 'MB/s' })
  })
})
