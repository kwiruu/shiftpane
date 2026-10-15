import { describe, expect, it } from 'vitest'
import {
  type HelperDisplay,
  matchDisplay,
  matchSource,
  type ScreenDisplay,
  type ScreenSource,
} from './match.ts'

const virtual: HelperDisplay = {
  id: '\\\\.\\DISPLAY8',
  name: 'VDD by MTT',
  x: 5760,
  y: 0,
  width: 800,
  height: 600,
}

const screen = (
  id: number,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ScreenDisplay => ({ id, label, physicalBounds: { x, y, width, height } })

const physical = [
  screen(2990884370, 'Mi Monitor', 0, 0, 1920, 1080),
  screen(1574832131, 'HP 524pf', 1920, 0, 1920, 1080),
  screen(111, 'Third', 3840, 0, 1920, 1080),
]

describe('matchDisplay', () => {
  it('finds the display at the helper rectangle', () => {
    const vdd = screen(4242, 'VDD by MTT', 5760, 0, 800, 600)
    const result = matchDisplay(virtual, [...physical, vdd])
    expect(result).toEqual({ ok: true, display: vdd, by: 'bounds' })
  })

  it('compares physical pixels, not the scaled bounds Electron reports', () => {
    // The monitor is at 150%: 1920x1080 physical is 1280x720 DIPs. Matching on the DIPs would
    // never find it, and a 1280x720 helper size would wrongly match the DIP rectangle.
    const scaled: ScreenDisplay = {
      id: 7,
      label: 'VDD by MTT',
      physicalBounds: { x: 3840, y: 0, width: 1920, height: 1080 },
    }
    const target = { ...virtual, x: 3840, y: 0, width: 1920, height: 1080 }
    expect(matchDisplay(target, [...physical.slice(0, 2), scaled])).toMatchObject({
      ok: true,
      display: { id: 7 },
      by: 'bounds',
    })
  })

  it('never takes a real monitor that only has the same size', () => {
    const target = { ...virtual, width: 1920, height: 1080, name: 'VDD by MTT' }
    // Same size as three physical monitors, none at the helper's position, none with its name.
    expect(matchDisplay(target, physical)).toEqual({ ok: false, reason: 'no-display' })
  })

  it('falls back to name and size when the position moved', () => {
    const moved = screen(9, 'VDD by MTT', 5800, 40, 800, 600)
    expect(matchDisplay(virtual, [...physical, moved])).toEqual({
      ok: true,
      display: moved,
      by: 'label-and-size',
    })
  })

  it('does not fall back when two displays qualify', () => {
    const a = screen(9, 'VDD by MTT', 6000, 0, 800, 600)
    const b = screen(10, 'vdd by mtt', 7000, 0, 800, 600)
    expect(matchDisplay(virtual, [a, b])).toEqual({ ok: false, reason: 'ambiguous' })
  })

  it('treats an empty name as no name at all', () => {
    const unnamed = screen(9, '', 6000, 0, 800, 600)
    expect(matchDisplay({ ...virtual, name: '' }, [unnamed])).toEqual({
      ok: false,
      reason: 'no-display',
    })
  })

  it('prefers the cloned display whose name matches', () => {
    const clone = screen(1, 'Other', 5760, 0, 800, 600)
    const vdd = screen(2, 'VDD by MTT', 5760, 0, 800, 600)
    expect(matchDisplay(virtual, [clone, vdd])).toMatchObject({ ok: true, display: { id: 2 } })
  })

  it('reports no display for an empty list', () => {
    expect(matchDisplay(virtual, [])).toEqual({ ok: false, reason: 'no-display' })
  })
})

describe('matchSource', () => {
  const sources: ScreenSource[] = [
    { id: 'screen:0:0', name: 'Screen 1', display_id: '2990884370' },
    { id: 'screen:1:0', name: 'Screen 2', display_id: '1574832131' },
    { id: 'screen:2:0', name: 'Screen 3', display_id: '4242' },
  ]

  it('picks the source whose display_id is the display id', () => {
    expect(matchSource({ id: 4242 }, sources)).toEqual({ ok: true, source: sources[2] })
  })

  it('does not use the position in the list', () => {
    const shuffled = [sources[2], sources[0], sources[1]] as ScreenSource[]
    expect(matchSource({ id: 1574832131 }, shuffled)).toEqual({ ok: true, source: sources[1] })
  })

  it('reports a missing source', () => {
    expect(matchSource({ id: 5 }, sources)).toEqual({ ok: false, reason: 'no-source' })
    expect(matchSource({ id: 5 }, [])).toEqual({ ok: false, reason: 'no-source' })
  })

  it('says so when no source carries a display id, which is what listing too early gives', () => {
    const early = sources.map((source) => ({ ...source, display_id: '' }))
    expect(matchSource({ id: 4242 }, early)).toEqual({ ok: false, reason: 'no-display-ids' })
  })
})
