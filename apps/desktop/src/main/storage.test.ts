import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileStorage } from './storage.ts'

describe('fileStorage', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('reads nothing before the first save, then what was saved', async () => {
    dir = await mkdtemp(join(tmpdir(), 'shiftpane-storage-'))
    const storage = fileStorage(join(dir, 'board.json'))
    expect(await storage.read()).toBeNull()
    await storage.write('{"a":1}')
    expect(await storage.read()).toBe('{"a":1}')
    expect(await readFile(join(dir, 'board.json'), 'utf8')).toBe('{"a":1}')
  })
})
