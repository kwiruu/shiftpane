import { describe, expect, it } from 'vitest'
import type { Permissions } from './manifest.ts'
import {
  addedPermissions,
  asksBeforeInstall,
  canSendOffPc,
  describePermissions,
  needsNothing,
} from './permissions.ts'

const none: Permissions = { sources: [], actions: [], local: [], network: [], secrets: [] }

describe('describePermissions', () => {
  it('says each permission the way the install prompt does', () => {
    const lines = describePermissions({
      ...none,
      sources: ['gpu'],
      network: ['api.github.com'],
      secrets: ['GITHUB_TOKEN'],
    })
    expect(lines.map((line) => line.text)).toEqual([
      'Reads your GPU load',
      'Can reach api.github.com',
      'Needs your GITHUB_TOKEN',
    ])
  })

  it('tells this PC from the local network', () => {
    const texts = describePermissions({
      ...none,
      local: ['127.0.0.1:8085', '192.168.1.20:8123'],
    }).map((line) => line.text)
    expect(texts).toEqual([
      'Can reach 127.0.0.1:8085 on your PC',
      'Can reach 192.168.1.20:8123 on your network',
    ])
  })

  it('marks sources that reveal what you do, and local apps, as asking first', () => {
    const lines = describePermissions({
      ...none,
      sources: ['cpu', 'media'],
      local: ['127.0.0.1:8085'],
    })
    expect(lines.map((line) => line.asks)).toEqual([false, true, true])
  })
})

describe('canSendOffPc', () => {
  it('flags a revealing source together with a host', () => {
    expect(canSendOffPc({ ...none, sources: ['media'], network: ['example.com'] })).toBe(true)
    expect(canSendOffPc({ ...none, sources: ['active-window'], local: ['127.0.0.1:9000'] })).toBe(
      true,
    )
  })

  it('leaves plain PC stats with a host alone, and revealing sources without one', () => {
    expect(canSendOffPc({ ...none, sources: ['cpu'], network: ['example.com'] })).toBe(false)
    expect(canSendOffPc({ ...none, sources: ['media'] })).toBe(false)
  })
})

describe('asksBeforeInstall and needsNothing', () => {
  it('asks for media, not for the GPU', () => {
    expect(asksBeforeInstall({ ...none, sources: ['media'] })).toBe(true)
    expect(asksBeforeInstall({ ...none, sources: ['gpu'] })).toBe(false)
  })

  it('knows a widget that needs nothing', () => {
    expect(needsNothing(none)).toBe(true)
    expect(needsNothing({ ...none, actions: ['media.next'] })).toBe(false)
  })
})

describe('addedPermissions', () => {
  it('lists only what the newer version adds', () => {
    const before: Permissions = { ...none, sources: ['cpu'] }
    const after: Permissions = { ...none, sources: ['cpu', 'memory'], network: ['api.github.com'] }
    expect(addedPermissions(before, after).map((line) => line.value)).toEqual([
      'memory',
      'api.github.com',
    ])
  })

  it('is empty when nothing changed', () => {
    expect(addedPermissions(none, none)).toEqual([])
  })
})
