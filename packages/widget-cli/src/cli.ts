import { watch } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkFolder, type FolderReport, packFolder } from '@shiftpane/widget-runtime'
import { describePermissions } from '@shiftpane/widget-sdk'
import { configFromArgs, runOnce } from './dev.ts'

const VERSION = '0.5.0'

const HELP = `shiftpane-widget ${VERSION}: check, run and pack ShiftPane widgets

  shiftpane-widget validate [folder]   every check the marketplace runs that can run here
  shiftpane-widget dev [folder]        run the collector on the sample PC, again on every save
      --config key=value               a config value (repeat for more); defaults fill the rest
      --once                           run once and stop
  shiftpane-widget pack [folder]       make the zip the marketplace takes: <id>-<version>.zip
      --out <file>                     where to write it

Secrets a widget declares are read from environment variables of the same name, such as
GITHUB_TOKEN. To see it on your phone: in ShiftPane, turn on Developer mode in Settings, then
Marketplace > Installed > Choose a folder. It reloads when you save.
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

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', multiple: true },
      once: { type: 'boolean' },
      out: { type: 'string' },
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
