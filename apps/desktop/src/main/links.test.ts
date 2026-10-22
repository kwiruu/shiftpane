import { describe, expect, it } from 'vitest'
import { installLinkId, installLinkIn } from './links.ts'

describe('installLinkId', () => {
  it('reads the widget id from an install link', () => {
    expect(installLinkId('shiftpane://install/gpu-ring')).toBe('gpu-ring')
    expect(installLinkId('shiftpane://install/github-stars/')).toBe('github-stars')
  })

  it('takes nothing else', () => {
    for (const link of [
      'https://shiftpane.vercel.app/widgets/gpu-ring',
      'shiftpane://uninstall/gpu-ring',
      'shiftpane://install/../../etc',
      'shiftpane://install/GPU',
      'shiftpane://install/gpu-ring/extra',
      'shiftpane://install/',
      'not a link',
    ]) {
      expect(installLinkId(link), link).toBeNull()
    }
  })

  it('finds a link among the arguments Windows starts the app with', () => {
    expect(installLinkIn(['shiftpane.exe', '--flag', 'shiftpane://install/gpu-ring'])).toBe(
      'gpu-ring',
    )
    expect(installLinkIn(['shiftpane.exe'])).toBeNull()
  })
})
