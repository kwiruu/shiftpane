import { join, resolve } from 'node:path'

export interface LocateOptions {
  /** `app.isPackaged`. */
  packaged: boolean
  platform: NodeJS.Platform
  /** `process.resourcesPath`: where electron-builder's `extraResources` land. */
  resourcesPath: string
  /** `app.getAppPath()`: `apps/desktop` when running from source. */
  appPath: string
  env: Readonly<Record<string, string | undefined>>
  /** Last-modified time in milliseconds, or null when the file does not exist. */
  mtimeMs(path: string): number | null
}

export type LocateResult =
  | { path: string; searched: string[] }
  | { path: null; searched: string[]; message: string }

export function helperBinaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'shiftpane-helper.exe' : 'shiftpane-helper'
}

/**
 * Finds `shiftpane-helper`.
 *
 * Packaged: electron-builder copies the release build to `resources/bin` (see
 * `extraResources` in electron-builder.yml). From source: the Cargo target directory at the
 * repo root, taking whichever of `debug` and `release` was built last. `SHIFTPANE_HELPER`
 * overrides both when running from source; a packaged app ignores it, because the helper is
 * what Windows starts elevated and the path it runs must not be steerable from the environment.
 */
export function locateHelper(options: LocateOptions): LocateResult {
  const name = helperBinaryName(options.platform)

  if (options.packaged) {
    const path = join(options.resourcesPath, 'bin', name)
    return options.mtimeMs(path) === null
      ? {
          path: null,
          searched: [path],
          message: `The display helper is missing from this install (${path}). Reinstall ShiftPane.`,
        }
      : { path, searched: [path] }
  }

  const override = options.env.SHIFTPANE_HELPER?.trim()
  if (override) {
    return options.mtimeMs(override) === null
      ? {
          path: null,
          searched: [override],
          message: `SHIFTPANE_HELPER points at ${override}, which does not exist.`,
        }
      : { path: override, searched: [override] }
  }

  const repoRoot = resolve(options.appPath, '..', '..')
  const targetDir = options.env.CARGO_TARGET_DIR?.trim()
  const targetRoot = targetDir ? resolve(repoRoot, targetDir) : join(repoRoot, 'target')
  const searched = ['debug', 'release'].map((profile) => join(targetRoot, profile, name))

  let best: { path: string; mtime: number } | null = null
  for (const path of searched) {
    const mtime = options.mtimeMs(path)
    if (mtime !== null && (best === null || mtime > best.mtime)) best = { path, mtime }
  }
  return best
    ? { path: best.path, searched }
    : {
        path: null,
        searched,
        message:
          'The display helper is not built. Run `cargo build -p shiftpane-helper` in the repo.',
      }
}
