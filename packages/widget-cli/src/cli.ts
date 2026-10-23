import { watch } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkFolder, type FolderReport, packFolder } from '@shiftpane/widget-runtime'
import { describePermissions, MARKETPLACE_URL } from '@shiftpane/widget-sdk'
import {
  credentialsPath,
  deviceSignIn,
  marketplaceApi,
  readCredentials,
  removeCredentials,
  tokenFor,
  upload,
  writeCredentials,
} from './account.ts'
import { configFromArgs, runOnce } from './dev.ts'

const VERSION = '0.5.1'

const HELP = `shiftpane-widget ${VERSION}: check, run, pack and publish ShiftPane widgets

  shiftpane-widget validate [folder]   every check the marketplace runs that can run here
  shiftpane-widget dev [folder]        run the collector on the sample PC, again on every save
      --config key=value               a config value (repeat for more); defaults fill the rest
      --once                           run once and stop
  shiftpane-widget pack [folder]       make the zip the marketplace takes: <id>-<version>.zip
      --out <file>                     where to write it
  shiftpane-widget login               sign in to the marketplace with GitHub (a code to type)
      --print-token                    print the token instead of keeping it, for a CI secret
  shiftpane-widget publish [folder]    check, pack and upload it for review
      --notes <text>                   what changed, for the reviewer
  shiftpane-widget whoami              who the marketplace thinks you are
  shiftpane-widget logout              sign out, ending the token

publish uses SHIFTPANE_TOKEN when it is set, otherwise the sign-in from login.

Secrets a widget declares are read from environment variables of the same name, such as
GITHUB_TOKEN. To see it on your phone: in ShiftPane, turn on Developer mode in Settings, then
Widgets > Installed > Choose a folder. It reloads when you save.
`

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const red = paint(31)
const green = paint(32)
const yellow = paint(33)
const dim = paint(2)

function printReport(report: FolderReport): boolean {
  const { widget, problems, warnings } = report
  if (widget) {
    const { manifest } = widget
    console.info(
      `${manifest.name} ${dim(`${manifest.id} ${manifest.version} by ${manifest.author}`)}`,
    )
    const lines = describePermissions(manifest.permissions)
    if (lines.length === 0) console.info(dim('  needs nothing from the PC'))
    for (const line of lines) console.info(`  ${line.asks ? yellow('!') : dim('-')} ${line.text}`)
  }
  for (const warning of warnings) console.info(yellow(`  ! ${warning}`))
  for (const problem of problems) console.info(red(`  x ${problem}`))
  if (problems.length === 0) console.info(green('  ok: the marketplace would take it'))
  return problems.length === 0
}

async function validate(folder: string): Promise<number> {
  return printReport(await checkFolder(folder)) ? 0 : 1
}

async function pack(folder: string, out: string | undefined): Promise<number> {
  const result = await packFolder(folder)
  if (!result.ok) {
    printReport(result.report)
    return 1
  }
  const file = resolve(out ?? result.fileName)
  await writeFile(file, result.zip)
  console.info(`${green('packed')} ${file}`)
  console.info(dim(`  ${result.zip.byteLength} bytes, sha256 ${result.sha256}`))
  return 0
}

async function dev(folder: string, pairs: string[], once: boolean): Promise<number> {
  let running = false
  let again = false
  const run = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    console.info(dim(`\n${new Date().toLocaleTimeString()}`))
    const report = await checkFolder(folder)
    const fine = printReport(report)
    if (report.widget) {
      const { config, problems } = configFromArgs(report.widget.manifest.config, pairs)
      for (const problem of problems) console.info(red(`  x ${problem}`))
      if (report.widget.collector === undefined) {
        console.info(dim('  no collector: the view reads its sources only'))
      } else {
        const result = await runOnce(report.widget, config)
        if (result.unset.length > 0) {
          console.info(
            yellow(`  set ${result.unset.map((key) => `--config ${key}=...`).join(' ')}`),
          )
        } else if (!result.ok) {
          console.info(red(`  x the collector failed: ${result.error}`))
        } else {
          console.info(`  collector returned ${dim(`in ${result.ms} ms`)}`)
          console.info(JSON.stringify(result.output, null, 2).replace(/^/gm, '    '))
          for (const bind of result.missing) {
            console.info(yellow(`  ! the view reads ${bind}, which the output doesn't have`))
          }
        }
      }
    }
    running = false
    if (again) {
      again = false
      await run()
    }
    return fine
  }
  const fine = await run()
  if (once) return fine ? 0 : 1
  console.info(dim(`\nwatching ${folder}; Ctrl+C to stop`))
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(folder, () => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(), 200)
  })
  return new Promise<number>(() => {})
}

async function login(printToken: boolean): Promise<number> {
  const api = marketplaceApi()
  // With --print-token, stdout carries only the token, so a script can take it.
  const say = (line: string) => (printToken ? console.error(line) : console.info(line))
  const signedIn = await deviceSignIn(api, say)
  if (printToken) {
    process.stdout.write(`${signedIn.token}\n`)
    console.error(
      dim(`Signed in as ${signedIn.login}. Keep it as SHIFTPANE_TOKEN; logout won't end it.`),
    )
    return 0
  }
  const path = credentialsPath()
  await writeCredentials(path, signedIn)
  console.info(`${green('signed in')} as ${signedIn.login}`)
  console.info(dim(`  kept in ${path}`))
  return 0
}

async function logout(): Promise<number> {
  const path = credentialsPath()
  const saved = await readCredentials(path)
  if (!saved) {
    console.info('Not signed in.')
    return 0
  }
  // The token stops working on the marketplace too, not just here.
  await marketplaceApi()('POST', '/auth/logout', { token: saved.token }).catch(() => undefined)
  await removeCredentials(path)
  console.info(`Signed ${saved.login} out.`)
  return 0
}

async function whoami(): Promise<number> {
  const token = await tokenFor(credentialsPath())
  if (!token) {
    console.info('Not signed in. Run shiftpane-widget login.')
    return 1
  }
  const answer = await marketplaceApi()('GET', '/me', { token })
  const user = answer.body.user as { login?: string; role?: string } | undefined
  if (answer.status !== 200 || !user?.login) {
    console.info(red('The sign-in ran out. Run shiftpane-widget login again.'))
    return 1
  }
  console.info(`${user.login}${user.role && user.role !== 'author' ? dim(` (${user.role})`) : ''}`)
  return 0
}

async function publish(folder: string, notes: string | undefined): Promise<number> {
  const token = await tokenFor(credentialsPath())
  if (!token) {
    console.info(red('Sign in first: shiftpane-widget login (or set SHIFTPANE_TOKEN).'))
    return 1
  }
  const packed = await packFolder(folder)
  if (!packed.ok) {
    printReport(packed.report)
    return 1
  }
  const { manifest } = packed.widget
  console.info(
    `${manifest.name} ${dim(`${manifest.id} ${manifest.version}, ${packed.zip.byteLength} bytes`)}`,
  )
  const result = await upload(marketplaceApi(), token, packed.zip, notes ?? '')
  if (!result.ok) {
    for (const problem of result.problems) console.info(red(`  x ${problem}`))
    return 1
  }
  const name = `${result.widgetId} ${result.version}`
  if (result.status === 'approved') {
    console.info(
      `${green('published')} ${name}: the fast lane took it (${result.fastLane ?? 'no review needed'}).`,
    )
  } else {
    console.info(`${green('uploaded')} ${name}: a person reviews it next.`)
  }
  console.info(dim(`  ${MARKETPLACE_URL}/dashboard`))
  return 0
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', multiple: true },
      once: { type: 'boolean' },
      out: { type: 'string' },
      notes: { type: 'string' },
      'print-token': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  const [command, folder = '.'] = positionals
  if (values.version) {
    console.info(VERSION)
    return 0
  }
  const path = resolve(folder)
  switch (command) {
    case 'validate':
    case 'check':
      return validate(path)
    case 'pack':
      return pack(path, values.out)
    case 'dev':
      return dev(path, values.config ?? [], values.once ?? false)
    case 'login':
      return login(values['print-token'] ?? false)
    case 'logout':
      return logout()
    case 'whoami':
      return whoami()
    case 'publish':
      return publish(path, values.notes)
    default:
      console.info(HELP)
      return command && !values.help ? 1 : 0
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(red(error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  },
)
