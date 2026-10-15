import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { helperBinaryName, type LocateOptions, locateHelper } from './locate.ts'

const appPath = resolve('/work/shiftpane/apps/desktop')
const repoRoot = resolve('/work/shiftpane')

function options(files: Record<string, number>, overrides: Partial<LocateOptions> = {}) {
  const known = new Map(Object.entries(files).map(([path, mtime]) => [resolve(path), mtime]))
  return {
    packaged: false,
    platform: 'win32',
    resourcesPath: resolve('/install/ShiftPane/resources'),
    appPath,
    env: {},
    mtimeMs: (path: string) => known.get(resolve(path)) ?? null,
    ...overrides,
  } satisfies LocateOptions
}

describe('locateHelper', () => {
  it('uses resources/bin in a packaged app', () => {
    const path = join(resolve('/install/ShiftPane/resources'), 'bin', 'shiftpane-helper.exe')
    expect(locateHelper(options({ [path]: 1 }, { packaged: true }))).toEqual({
      path,
      searched: [path],
    })
  })

  it('says to reinstall when a packaged app has lost its helper', () => {
    const result = locateHelper(options({}, { packaged: true }))
    expect(result.path).toBeNull()
    expect(result).toMatchObject({ message: expect.stringContaining('Reinstall') })
  })

  it('ignores the environment override in a packaged app', () => {
    const packagedPath = join(
      resolve('/install/ShiftPane/resources'),
      'bin',
      'shiftpane-helper.exe',
    )
    const result = locateHelper(
      options(
        { [packagedPath]: 1, '/tmp/evil.exe': 1 },
        { packaged: true, env: { SHIFTPANE_HELPER: '/tmp/evil.exe' } },
      ),
    )
    expect(result.path).toBe(packagedPath)
  })

  it('takes the most recently built profile when running from source', () => {
    const debug = join(repoRoot, 'target', 'debug', 'shiftpane-helper.exe')
    const release = join(repoRoot, 'target', 'release', 'shiftpane-helper.exe')
    expect(locateHelper(options({ [debug]: 200, [release]: 100 })).path).toBe(debug)
    expect(locateHelper(options({ [debug]: 100, [release]: 200 })).path).toBe(release)
    expect(locateHelper(options({ [release]: 100 })).path).toBe(release)
  })

  it('honours SHIFTPANE_HELPER and CARGO_TARGET_DIR when running from source', () => {
    const custom = resolve('/tools/helper.exe')
    expect(locateHelper(options({ [custom]: 1 }, { env: { SHIFTPANE_HELPER: custom } })).path).toBe(
      custom,
    )

    const elsewhere = join(resolve('/build-cache'), 'debug', 'shiftpane-helper.exe')
    expect(
      locateHelper(
        options({ [elsewhere]: 1 }, { env: { CARGO_TARGET_DIR: resolve('/build-cache') } }),
      ).path,
    ).toBe(elsewhere)
  })

  it('does not fall back when an explicit override is wrong', () => {
    const debug = join(repoRoot, 'target', 'debug', 'shiftpane-helper.exe')
    const result = locateHelper(
      options({ [debug]: 1 }, { env: { SHIFTPANE_HELPER: resolve('/nope.exe') } }),
    )
    expect(result.path).toBeNull()
  })

  it('tells a developer how to build the helper', () => {
    const result = locateHelper(options({}))
    expect(result).toMatchObject({
      path: null,
      message: expect.stringContaining('cargo build -p shiftpane-helper'),
    })
    expect(result.searched).toHaveLength(2)
  })

  it('names the binary per platform', () => {
    expect(helperBinaryName('win32')).toBe('shiftpane-helper.exe')
    expect(helperBinaryName('darwin')).toBe('shiftpane-helper')
    expect(helperBinaryName('linux')).toBe('shiftpane-helper')
  })
})
