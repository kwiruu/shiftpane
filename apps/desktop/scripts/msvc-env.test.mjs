import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasCppLibraries, parseEnvironment, withWindowsFolders } from './msvc-env.mjs'

/** A fake disk: the files that exist, and the directories `list` can read. */
function disk(files) {
  const names = new Set(files.map((file) => join(...file)))
  return {
    exists: (path) => names.has(path),
    list: (path) => {
      const versions = files
        .filter((file) => join(...file.slice(0, 4)) === path)
        .map((file) => file[4])
      if (versions.length === 0) throw new Error('ENOENT')
      return versions
    },
  }
}

const tools = (install) => [install, 'VC', 'Tools', 'MSVC']

describe('hasCppLibraries', () => {
  it('is true when an MSVC version has msvcrt.lib for x64', () => {
    const install = 'C:\\VS\\2022\\BuildTools'
    const fs = disk([[...tools(install), '14.44.35207', 'lib', 'x64', 'msvcrt.lib']])
    expect(hasCppLibraries(install, fs)).toBe(true)
  })

  it('is false for an install that has a linker but no libraries', () => {
    const install = 'C:\\VS\\18\\Community'
    const fs = {
      exists: (path) => path === join(...tools(install), '14.51.36231', 'bin', 'link.exe'),
      list: () => ['14.51.36231'],
    }
    expect(hasCppLibraries(install, fs)).toBe(false)
  })

  it('is false when there is no C++ toolset at all', () => {
    expect(hasCppLibraries('C:\\VS\\nothing', disk([]))).toBe(false)
  })
})

describe('withWindowsFolders', () => {
  it('fills in the folders a stripped environment lacks, on the system drive', () => {
    expect(withWindowsFolders({ SystemDrive: 'D:', Path: 'x' })).toEqual({
      SystemDrive: 'D:',
      Path: 'x',
      ProgramData: 'D:\\ProgramData',
      ProgramFiles: 'D:\\Program Files',
      'ProgramFiles(x86)': 'D:\\Program Files (x86)',
    })
  })

  it('keeps the ones it was given', () => {
    const env = { ProgramData: 'E:\\Data', ProgramFiles: 'E:\\PF', 'ProgramFiles(x86)': 'E:\\PF86' }
    expect(withWindowsFolders(env)).toEqual(env)
  })
})

describe('parseEnvironment', () => {
  it('reads variables, keeps values with = in them and skips cmd bookkeeping lines', () => {
    const output = [
      '=C:=C:\\Users\\Keiru',
      'LIB=C:\\VC\\lib\\x64;C:\\SDK\\um\\x64',
      'Path=C:\\VC\\bin;C:\\Windows',
      'ProgramFiles(x86)=C:\\Program Files (x86)',
      'FLAGS=a=b',
      'not a variable',
      '',
    ].join('\r\n')
    expect(parseEnvironment(output)).toEqual({
      LIB: 'C:\\VC\\lib\\x64;C:\\SDK\\um\\x64',
      Path: 'C:\\VC\\bin;C:\\Windows',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      FLAGS: 'a=b',
    })
  })
})
