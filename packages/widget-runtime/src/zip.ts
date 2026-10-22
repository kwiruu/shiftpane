import { createHash } from 'node:crypto'
import { packageLimits } from '@shiftpane/widget-sdk'
import { unzipSync, zipSync } from 'fflate'
import { PACKAGE_FILES, type PackageFile, type PackageTexts } from './folder.ts'

/**
 * The zip a widget ships as: fixed file names and nothing else, at most 1 MB unpacked. Opening
 * never inflates more than the limit allows, so a zip bomb fails on its declared sizes before
 * any of it is unpacked. The marketplace's checks open uploads the same way.
 */

const OPTIONAL = new Set(['collector.js', 'icon.png'])
const REQUIRED = new Set(['manifest.json', 'view.json', 'sample.json', 'README.md', 'LICENSE'])
const SCREENSHOT = /^screenshots\/[a-z0-9][a-z0-9._-]{0,63}\.png$/i

export interface OpenedPackage {
  sha256: string
  /** Bytes of the zip itself. */
  size: number
  /** The allowed files, by name. Empty when the zip failed a check. */
  files: Map<string, Uint8Array>
  /** Why it failed; empty when it passed. */
  problems: string[]
}

const isAllowed = (name: string) =>
  REQUIRED.has(name) || OPTIONAL.has(name) || SCREENSHOT.test(name)

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function openPackage(zip: Uint8Array): OpenedPackage {
  const opened: OpenedPackage = {
    sha256: sha256(zip),
    size: zip.byteLength,
    files: new Map(),
    problems: [],
  }
  const { problems } = opened
  if (zip.byteLength > packageLimits.totalBytes) {
    problems.push('The zip is over 1 MB.')
    return opened
  }
  const seen = new Set<string>()
  const declared = new Map<string, number>()
  let total = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip, {
      filter(file) {
        if (file.name.endsWith('/')) return false
        if (seen.has(file.name)) problems.push(`${file.name} is in the zip twice.`)
        seen.add(file.name)
        if (!isAllowed(file.name)) {
          problems.push(`${file.name} isn't allowed in a package.`)
          return false
        }
        declared.set(file.name, file.originalSize)
        total += file.originalSize
        return total <= packageLimits.totalBytes
      },
    })
  } catch {
    problems.push("The zip can't be read.")
    return opened
  }
  if (total > packageLimits.totalBytes) problems.push('Its files add up to more than 1 MB.')
  for (const [name, bytes] of Object.entries(entries)) {
    if (bytes.byteLength !== declared.get(name)) problems.push(`${name} isn't the size it says.`)
    opened.files.set(name, bytes)
  }
  for (const name of REQUIRED) if (!seen.has(name)) problems.push(`${name} is missing.`)
  if (problems.length > 0) opened.files.clear()
  return opened
}

const decoder = new TextDecoder('utf-8', { fatal: true })

/** The text files of an opened package, as `readPackage` and the store take them. */
export function packageTexts(opened: OpenedPackage): { texts: PackageTexts; problems: string[] } {
  const texts: PackageTexts = {}
  const problems: string[] = []
  for (const [key, name] of Object.entries(PACKAGE_FILES) as [PackageFile, string][]) {
    const bytes = opened.files.get(name)
    if (!bytes) continue
    try {
      texts[key] = decoder.decode(bytes)
    } catch {
      problems.push(`${name} isn't UTF-8 text.`)
    }
  }
  return { texts, problems }
}

/**
 * The same files always make the same zip: sorted names, a fixed date, no extra fields. So a
 * package's sha256 follows from its contents, and packing the same folder twice gives the same
 * package.
 *
 * Zip dates are local time, so the fixed date is midnight local time: a UTC date would be written
 * as a different hour in each time zone, and the same files would pack differently on a server
 * and on a laptop.
 */
const FIXED_DATE = new Date(1980, 0, 1)

export function packPackage(files: Record<string, Uint8Array | string>): Uint8Array {
  const encoder = new TextEncoder()
  const entries: Record<string, [Uint8Array, { level: 9; mtime: Date }]> = {}
  for (const name of Object.keys(files).sort()) {
    const value = files[name]
    if (value === undefined) continue
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    entries[name] = [bytes, { level: 9, mtime: FIXED_DATE }]
  }
  return zipSync(entries)
}
