import { describe, expect, it } from 'vitest'
import { SettingsService } from './settings.ts'
import type { TextStorage } from './storage.ts'

function memory(initial: string | null = null): TextStorage & { text: string | null } {
  const store = {
    text: initial,
    read: async () => store.text,
    write: async (text: string) => {
      store.text = text
    },
  }
  return store
}

describe('SettingsService', () => {
  it('changes only the settings a patch names', async () => {
    const storage = memory()
    const settings = new SettingsService(storage)
    await settings.set({ developerMode: true })
    await settings.set({ generatorModel: 'qwen3:4b' })
    await settings.set({ monitorScale: 175 })
    expect(await settings.get()).toEqual({
      developerMode: true,
      generatorModel: 'qwen3:4b',
      monitorScale: 175,
    })
    expect(JSON.parse(storage.text ?? '')).toEqual(await settings.get())
  })

  it('fills in what an older file did not have, and ignores what it should not', async () => {
    const settings = new SettingsService(memory('{"developerMode":true}'))
    expect(await settings.get()).toEqual({
      developerMode: true,
      generatorModel: null,
      monitorScale: 'phone',
    })
    await settings.set({ monitorScale: 9000 } as never)
    expect((await settings.get()).monitorScale).toBe('phone')
  })
})
