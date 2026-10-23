// Validate copied resources, rather than only trusting the source tree or a previous build.
const { spawnSync } = require('node:child_process')
const { readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

module.exports = async function validatePackage(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources')
  const expected = Number(
    readFileSync(
      resolve(__dirname, '../../../packages/helper-client/src/version.ts'),
      'utf8',
    ).match(/export const HELPER_PROTOCOL_VERSION = (\d+)/)?.[1],
  )
  if (!Number.isInteger(expected) || expected < 1)
    throw new Error('Cannot determine the expected helper protocol')
  const helper = join(
    resources,
    'bin',
    context.electronPlatformName === 'win32' ? 'shiftpane-helper.exe' : 'shiftpane-helper',
  )
  const run = spawnSync(helper, [], {
    input: '{"id":1,"method":"helper.hello"}\n',
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  })
  if (run.error || run.status !== 0)
    throw new Error(`Packaged helper handshake failed: ${run.error?.message ?? run.stderr}`)
  const hello = run.stdout.split(/\r?\n/).flatMap((line) => {
    try {
      const message = JSON.parse(line)
      return message.id === 1 && message.result?.type === 'hello' ? [message.result] : []
    } catch {
      return []
    }
  })[0]
  if (hello?.protocolVersion !== expected) {
    throw new Error(
      `Packaged helper speaks protocol ${hello?.protocolVersion ?? 'unknown'}; the app requires ${expected}. Rebuild the native release helper before packaging.`,
    )
  }
  const phone = join(resources, 'phone')
  const html = readFileSync(join(phone, 'index.html'), 'utf8')
  const entry = html.match(/<script[^>]+src="([^" ]+\.js)"/)?.[1]
  if (!entry || !existsSync(join(phone, entry)))
    throw new Error('Packaged phone page is missing its JavaScript entry')
  console.info(`Verified packaged helper protocol ${expected} and phone entry`)
}
