import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { openPackage, packageTexts, packPackage } from './zip.ts'

const files = {
  'manifest.json': '{"id":"gpu-ring"}',
  'view.json': '{}',
  'sample.json': '{}',
  'README.md': '# GPU ring',
  LICENSE: 'MIT',
}

describe('packPackage and openPackage', () => {
  it('pack the same files into the same bytes, and open them again', () => {
    const zip = packPackage(files)
    expect(packPackage({ ...files })).toEqual(zip)
    const opened = openPackage(zip)
    expect(opened.problems).toEqual([])
    expect(packageTexts(opened).texts).toMatchObject({
      manifest: '{"id":"gpu-ring"}',
      readme: '# GPU ring',
      license: 'MIT',
    })
    expect(opened.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuse a file that has no place in a package, and a missing one', () => {
    const extra = openPackage(packPackage({ ...files, 'run.exe': 'MZ' }))
    expect(extra.problems).toContain("run.exe isn't allowed in a package.")
    expect(extra.files.size).toBe(0)
    const { LICENSE: _, ...noLicense } = files
    expect(openPackage(packPackage(noLicense)).problems).toContain('LICENSE is missing.')
  })

  it('stops at the size limit without inflating a zip bomb', () => {
    const bomb = zipSync({
      ...Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]),
      ),
      'collector.js': new Uint8Array(2 * 1024 * 1024),
    })
    const opened = openPackage(bomb)
    expect(opened.problems.some((problem) => problem.includes('more than 1 MB'))).toBe(true)
  })

  it('reads garbage as a zip it cannot read', () => {
    expect(openPackage(new TextEncoder().encode('not a zip')).problems).toEqual([
      "The zip can't be read.",
    ])
  })
})

describe('packPackage dates', () => {
  it('writes the same date in every time zone: midnight, 1 January 1980', () => {
    const zip = packPackage(files)
    // The first entry's DOS time and date, at offset 10 of its local header.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint16(10, true)).toBe(0)
    expect(view.getUint16(12, true)).toBe((0 << 9) | (1 << 5) | 1)
  })
})
