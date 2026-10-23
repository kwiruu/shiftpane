import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Recipe } from '../../shared/studio.ts'
import type { FolderCheck, InstalledInfo } from '../../shared/widgets.ts'
import { fileStorage } from '../storage.ts'
import type { InstalledWidgets } from './installed.ts'
import { Studio } from './studio.ts'

let root: string
let installed: Pick<InstalledInfo, 'id' | 'version'>[]
let checked: string[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shiftpane-studio-'))
  installed = []
  checked = []
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const recipe: Recipe = { name: 'GPU ring', sizes: ['small'], blocks: [{ show: 'gpu', as: 'ring' }] }

function setup() {
  const fake = {
    list: () => installed as InstalledInfo[],
    check: async (folder: string): Promise<FolderCheck> => {
      checked.push(folder)
      return { status: 'invalid', folder, problems: ['(test)'] }
    },
  } as unknown as InstalledWidgets
  return new Studio({
    installed: fake,
    folder: join(root, 'ShiftPane widgets'),
    storage: fileStorage(join(root, 'recipes.json')),
    appVersion: '0.5.0',
    now: () => new Date('2026-10-23T00:00:00Z'),
  })
}

const manifestIn = async (id: string) =>
  JSON.parse(await readFile(join(root, 'ShiftPane widgets', id, 'manifest.json'), 'utf8'))

describe('Studio', () => {
  it('writes a widget folder from a recipe and checks it like any folder', async () => {
    const studio = setup()
    await studio.save(recipe, null, 'kwiruu')
    expect(checked).toEqual([join(root, 'ShiftPane widgets', 'gpu-ring')])
    expect(await manifestIn('gpu-ring')).toMatchObject({
      id: 'gpu-ring',
      version: '0.1.0',
      author: 'kwiruu',
      permissions: { sources: ['gpu'] },
    })
    expect(await studio.get('gpu-ring')).toEqual({ id: 'gpu-ring', recipe, author: 'kwiruu' })
    // It's remembered between runs.
    expect(await setup().ids()).toEqual(['gpu-ring'])
  })

  it('gives a new widget an id no other has, and leaves folders it did not make alone', async () => {
    installed = [{ id: 'gpu-ring', version: '1.1.0' }]
    await mkdir(join(root, 'ShiftPane widgets', 'gpu-ring-2'), { recursive: true })
    const studio = setup()
    await studio.save(recipe, null, 'kwiruu')
    expect(await studio.ids()).toEqual(['gpu-ring-3'])
    // A built-in widget's id is never taken.
    await studio.save({ ...recipe, name: 'Clock' }, null, 'kwiruu')
    expect(await studio.ids()).toContain('clock-widget')
  })

  it('saves over its own widget a version up, and only its own', async () => {
    const studio = setup()
    await studio.save(recipe, null, 'kwiruu')
    installed = [{ id: 'gpu-ring', version: '0.1.0' }]
    await studio.save({ ...recipe, name: 'GPU' }, 'gpu-ring', 'kwiruu')
    expect(await manifestIn('gpu-ring')).toMatchObject({ name: 'GPU', version: '0.1.1' })
    // An id Studio didn't make gets a new widget instead of overwriting.
    await studio.save(recipe, 'pc-busy', 'kwiruu')
    expect(await studio.ids()).not.toContain('pc-busy')
  })

  it('refuses a recipe that is missing something, and saves an odd author as "me"', async () => {
    const studio = setup()
    expect(await studio.save({ name: 'x', sizes: [], blocks: [] }, null, 'kwiruu')).toMatchObject({
      status: 'invalid',
    })
    await studio.save(recipe, null, '../../etc')
    expect(await manifestIn('gpu-ring')).toMatchObject({ author: 'me' })
  })
})
