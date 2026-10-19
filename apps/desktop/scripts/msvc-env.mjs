// Windows only: finds a Visual Studio that has the x64 C++ libraries and returns the environment
// its vcvars64.bat sets up, so `cargo` links with it.
//
// Left to itself, rustc takes the link.exe of the newest launchable Visual Studio. One installed
// without the "Desktop development with C++" workload has a link.exe but no libraries, so every
// link fails with LNK1104 on msvcrt.lib, even when an older install (the Build Tools, which Visual
// Studio often flags as not launchable) has them.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Whether this Visual Studio install has the x64 C++ libraries, not only the compiler. */
export function hasCppLibraries(installPath, { exists = existsSync, list = readdirSync } = {}) {
  const tools = join(installPath, 'VC', 'Tools', 'MSVC')
  try {
    return list(tools).some((version) => exists(join(tools, version, 'lib', 'x64', 'msvcrt.lib')))
  } catch {
    return false
  }
}

/** Turns the output of `set` into an environment. Lines like `=C:=C:\dir` are not variables. */
export function parseEnvironment(output) {
  const env = {}
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1)
  }
  return env
}

/**
 * `env` with the standard Windows folders filled in where it lacks them. vswhere finds no
 * install without `ProgramData`, and vcvars64.bat looks for vswhere under `ProgramFiles(x86)`,
 * yet a task runner that passes only a few variables on (turbo does) leaves them out.
 */
export function withWindowsFolders(env) {
  const drive = env.SystemDrive ?? 'C:'
  return {
    ...env,
    ProgramData: env.ProgramData ?? `${drive}\\ProgramData`,
    ProgramFiles: env.ProgramFiles ?? `${drive}\\Program Files`,
    'ProgramFiles(x86)': env['ProgramFiles(x86)'] ?? `${drive}\\Program Files (x86)`,
  }
}

/**
 * The environment to run `cargo` in, with the install it came from, or null to leave things as
 * they are: not Windows on x64, already inside a build tools prompt, or no install to use.
 */
export function msvcEnvironment(given = process.env) {
  // vcvars64.bat is for x64 targets; an ARM64 PC builds for aarch64 and finds its own tools.
  if (process.platform !== 'win32' || process.arch !== 'x64' || given.VCINSTALLDIR) return null

  const env = withWindowsFolders(given)
  const vswhere = join(
    env['ProgramFiles(x86)'],
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  )
  if (!existsSync(vswhere)) return null
  // -all includes installs Visual Studio flags as incomplete or not launchable; -sort puts the newest first.
  const listed = spawnSync(
    vswhere,
    ['-all', '-prerelease', '-products', '*', '-sort', '-property', 'installationPath'],
    { encoding: 'utf8', env },
  )
  if (listed.status !== 0) return null

  const install = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((path) => hasCppLibraries(path))
  if (!install) return null
  const vcvars = join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  if (!existsSync(vcvars)) return null

  // `/s` strips the outer quotes, so the path inside can be quoted.
  const imported = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul && set"`], {
    encoding: 'utf8',
    env,
    windowsVerbatimArguments: true,
  })
  if (imported.status !== 0) return null
  const environment = parseEnvironment(imported.stdout)
  return environment.LIB ? { env: environment, install } : null
}
