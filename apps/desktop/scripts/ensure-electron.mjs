// Runs before `dev` and `preview`. pnpm sometimes skips or loses Electron's postinstall
// download (blocked install scripts, a dropped connection), which leaves the npm package
// without the actual Electron binary. Fetch it here instead of failing with "Electron uninstall".
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))

function binaryPresent() {
  try {
    return existsSync(require('electron'))
  } catch {
    return false
  }
}

if (!binaryPresent()) {
  console.info('Electron binary is missing; downloading it now (about 100 MB, one time)...')
  const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], {
    stdio: 'inherit',
  })
  if (result.status !== 0 || !binaryPresent()) {
    console.error(
      'Could not download Electron. Check your connection, then run: node node_modules/electron/install.js',
    )
    process.exit(1)
  }
}
