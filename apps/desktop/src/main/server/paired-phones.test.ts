import { generateDeviceKey } from '@shiftpane/protocol'
import { describe, expect, it } from 'vitest'
import type { TextStorage } from '../storage.ts'
import { MAX_REMEMBERED, PairedPhones } from './paired-phones.ts'

function memory(initial: string | null = null): TextStorage & { text: string | null } {
  const storage = {
    text: initial,
    read: async () => storage.text,
    write: async (text: string) => {
      storage.text = text
    },
  }
  return storage
}

describe('PairedPhones', () => {
  it('lets a paired phone back in with its key, and nobody else', async () => {
    const phones = new PairedPhones({ storage: memory(), now: () => 5 })
    const pairing = phones.add('iPhone')
    expect(phones.check(pairing.deviceId, pairing.key, 'iPhone')).toMatchObject({
      deviceId: pairing.deviceId,
      name: 'iPhone',
    })
    expect(phones.check(pairing.deviceId, generateDeviceKey(), 'iPhone')).toBeNull()
    expect(phones.check('someone-else', pairing.key, 'iPhone')).toBeNull()
  })

  it('keeps phones and the port across restarts, but never a key', async () => {
    const storage = memory()
    const first = new PairedPhones({ storage })
    const pairing = first.add('iPad')
    first.port = 47_821
    await first.flush()
    expect(storage.text).not.toContain(pairing.key)

    const second = new PairedPhones({ storage })
    await second.load()
    expect(second.port).toBe(47_821)
    expect(second.check(pairing.deviceId, pairing.key, 'iPad')).not.toBeNull()
  })

  it('forgets a phone for good', async () => {
    const storage = memory()
    const phones = new PairedPhones({ storage })
    const pairing = phones.add('iPhone')
    expect(phones.forget(pairing.deviceId)).toBe(true)
    expect(phones.forget(pairing.deviceId)).toBe(false)
    expect(phones.check(pairing.deviceId, pairing.key, 'iPhone')).toBeNull()
    await phones.flush()
    const reloaded = new PairedPhones({ storage })
    await reloaded.load()
    expect(reloaded.list).toEqual([])
  })

  it('lists the most recently seen first and drops the oldest beyond the limit', () => {
    let now = 0
    const phones = new PairedPhones({ storage: memory(), now: () => now })
    const first = phones.add('first')
    for (let i = 1; i < MAX_REMEMBERED; i++) {
      now = i
      phones.add(`phone ${i}`)
    }
    now = 100
    // Seen just now, so it is not the one dropped.
    phones.check(first.deviceId, first.key, 'first')
    now = 101
    phones.add('newest')
    expect(phones.list).toHaveLength(MAX_REMEMBERED)
    expect(phones.list[0]?.name).toBe('newest')
    expect(phones.list[1]?.name).toBe('first')
    expect(phones.list.map((phone) => phone.name)).not.toContain('phone 1')
  })

  it('starts empty from a missing, broken or tampered file', async () => {
    const logs: string[] = []
    for (const text of [null, 'not json', '{"version":1,"phones":[{"deviceId":"x"}]}']) {
      const phones = new PairedPhones({ storage: memory(text), log: (m) => logs.push(m) })
      await phones.load()
      expect(phones.list).toEqual([])
      expect(phones.port).toBeUndefined()
    }
    expect(logs).toHaveLength(2)
  })
})
