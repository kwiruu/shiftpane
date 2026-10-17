import { NO_INSETS } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import { screenLayout } from './screen.ts'

describe('screenLayout', () => {
  it('splits the whole screen when nothing is cropped', () => {
    const layout = screenLayout({ width: 852, height: 393 }, 3, 0.5, NO_INSETS)
    expect(layout?.area).toEqual({ x: 0, y: 0, width: 852, height: 393 })
    expect(layout?.split.monitor).toMatchObject({ x: 0, y: 0, width: 426 })
    expect(layout?.split.panel).toMatchObject({ x: 426, width: 426 })
  })

  it('crops the screen first and moves the monitor and widgets together', () => {
    const crop = { top: 0, right: 60, bottom: 0, left: 0 }
    const layout = screenLayout({ width: 852, height: 393 }, 3, 0.5, crop)
    expect(layout?.area).toEqual({ x: 0, y: 0, width: 792, height: 393 })
    expect(layout?.split.monitor).toMatchObject({ x: 0, width: 396 })
    expect(layout?.split.panel).toMatchObject({ x: 396, width: 396 })
    // The monitor the PC makes is the cropped monitor area, at the phone's pixels.
    expect(layout?.split.stream).toEqual({ width: 1188, height: 1178 })

    const left = screenLayout({ width: 852, height: 393 }, 3, 0.5, { ...crop, right: 0, left: 60 })
    expect(left?.split.monitor).toMatchObject({ x: 60, width: 396 })
    expect(left?.split.panel).toMatchObject({ x: 456, width: 396 })
  })

  it('has nothing to lay out when the crop leaves no screen', () => {
    const crop = { top: 0, right: 500, bottom: 0, left: 400 }
    expect(screenLayout({ width: 852, height: 393 }, 3, 0.5, crop)).toBeNull()
  })
})
