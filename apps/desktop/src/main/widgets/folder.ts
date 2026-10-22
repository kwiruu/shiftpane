import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { packageLimits } from '@shiftpane/widget-sdk'

/** The files of a widget package the app reads and keeps, by their fixed names. */
export const PACKAGE_FILES = {
  manifest: 'manifest.json',
  view: 'view.json',
  sample: 'sample.json',
  collector: 'collector.js',
  readme: 'README.md',
  license: 'LICENSE',
} as const

export type PackageFile = keyof typeof PACKAGE_FILES
export type PackageTexts = Partial<Record<PackageFile, string>>

const LIMITS: Record<PackageFile, number> = {
  manifest: packageLimits.manifestBytes,
  view: packageLimits.viewBytes,
  sample: packageLimits.sampleBytes,
  collector: packageLimits.collectorBytes,
  readme: 64 * 1024,
  license: 64 * 1024,
}

/**
 * Reads a widget package's files from a folder: only the fixed names, only plain files (no links
 * out of the folder), each within its size limit and all of them within the package's.
 */
export async function readWidgetFolder(
  folder: string,
): Promise<{ files: PackageTexts; problems: string[] }> {
  const files: PackageTexts = {}
  const problems: string[] = []
  let total = 0
  for (const [key, name] of Object.entries(PACKAGE_FILES) as [PackageFile, string][]) {
    const path = join(folder, name)
    let size: number
    try {
      const stat = await lstat(path)
      if (!stat.isFile()) {
        problems.push(`${name} has to be a plain file, not a link or a folder.`)
        continue
      }
      size = stat.size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      problems.push(`${name} can't be read: ${(error as Error).message}`)
      continue
    }
    if (size > LIMITS[key]) {
      problems.push(`${name} is over ${Math.round(LIMITS[key] / 1024)} KB.`)
      continue
    }
    total += size
    files[key] = await readFile(path, 'utf8')
  }
  if (total > packageLimits.totalBytes) problems.push('The package is over 1 MB.')
  return { files, problems }
}
