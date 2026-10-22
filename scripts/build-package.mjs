// Builds a workspace package for npm. Inside the repo every package exports its TypeScript
// source; a published one ships JavaScript and declarations instead (see `publishConfig` in its
// package.json, which pnpm swaps in when packing).
//
//   node ../../scripts/build-package.mjs [--bundle] [--types] <src/entry.ts:dist/out.js>...
//
// --bundle  bundle every dependency in (for a CLI that should install nothing); otherwise the
//           package's dependencies stay imports
// --types   emit declarations to dist/types, with `.ts` import paths turned into `.js`
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')

const args = process.argv.slice(2)
const bundleAll = args.includes('--bundle')
const types = args.includes('--types')
const entries = args.filter((arg) => !arg.startsWith('--')).map((arg) => arg.split(':'))

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const external = bundleAll
  ? []
  : Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).flatMap((name) => [
      name,
      `${name}/*`,
    ])

rmSync('dist', { recursive: true, force: true })

for (const [input, output] of entries) {
  const executable = output.includes('/cli') || output.includes('/bin')
  await build({
    entryPoints: [input],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external,
    legalComments: 'inline',
    // A bundled CommonJS dependency (QuickJS's loader) still calls `require`.
    banner: {
      js: `${executable ? '#!/usr/bin/env node\n' : ''}import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);`,
    },
  })
}

if (types) {
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
  execFileSync(
    process.execPath,
    [
      tsc,
      '-p',
      'tsconfig.json',
      '--noEmit',
      'false',
      '--declaration',
      '--emitDeclarationOnly',
      '--rootDir',
      '.',
      '--outDir',
      'dist/types',
    ],
    { stdio: 'inherit' },
  )
  // Declarations keep the source's `./file.ts` imports; published packages hold `.js`.
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.test.d.ts')) rmSync(path)
      else if (name.endsWith('.d.ts')) {
        const text = readFileSync(path, 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2')
        writeFileSync(path, text)
      }
    }
  }
  walk('dist/types')
}

console.info(`built ${pkg.name}`)
