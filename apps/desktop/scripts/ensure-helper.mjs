// Runs before `dev` and `preview`. From source the desktop app starts `shiftpane-helper` from
// the Cargo target directory at the repo root (see src/main/display/locate.ts), and nothing
// else builds it. Build it here so the virtual monitor works without a manual step and a
// stale binary never meets newer TypeScript. An up-to-date build is a no-op for Cargo.
//
// This never fails the dev run: without the helper the app still pairs phones and shows what to
// do in its window. Set SHIFTPANE_SKIP_HELPER_BUILD=1 to skip, or SHIFTPANE_HELPER to a binary
// of your own (then nothing is built).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.env.SHIFTPANE_SKIP_HELPER_BUILD === '1' || process.env.SHIFTPANE_HELPER) {
  process.exit(0)
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
console.info('Building the display helper (cargo build -p shiftpane-helper)...')
const result = spawnSync('cargo', ['build', '-p', 'shiftpane-helper'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (result.error && result.error.code === 'ENOENT') {
  console.warn(
    '\ncargo was not found, so the display helper was not built. Install Rust from https://rustup.rs ' +
      'to get the virtual monitor; the app starts without it.\n',
  )
} else if (result.status !== 0) {
  console.warn(
    '\nThe display helper did not build, so the virtual monitor may be missing or out of date. ' +
      'Fix the error above and run `cargo build -p shiftpane-helper`' +
      (process.platform === 'win32'
        ? ' from a shell that has the Visual Studio build tools environment (for example the "x64 Native Tools Command Prompt").\n'
        : '.\n'),
  )
}
