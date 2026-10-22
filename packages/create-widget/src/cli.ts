import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { type Answers, idFrom, type Template, templates, widgetFiles } from './templates.ts'

const HELP = `npm create shiftpane-widget [folder] -- [--template pc|web] [--name "My widget"] [--author <github login>]

  pc   reads the PC's CPU, with no code
  web  a collector that fetches from one host (GitHub, to start)
`

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      template: { type: 'string', short: 't' },
      name: { type: 'string' },
      author: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.info(HELP)
    return 0
  }
  const ask = process.stdin.isTTY && !values.yes
  const prompt = ask ? createInterface({ input: process.stdin, output: process.stdout }) : null
  const question = async (text: string, fallback: string) => {
    if (!prompt) return fallback
    const answer = (await prompt.question(`${text} (${fallback}) `)).trim()
    return answer || fallback
  }

  const folderName = positionals[0] ?? (await question('Folder for the widget', 'my-widget'))
  const folder = resolve(folderName)
  const name = values.name ?? (await question('Its name', titleOf(basename(folder))))
  const author = values.author ?? (await question('Your GitHub login', 'your-github-login'))
  const picked = values.template ?? (await question('Template: pc or web', 'pc'))
  prompt?.close()
  if (!templates.includes(picked as Template)) {
    console.error(`There is no "${picked}" template. Pick pc or web.`)
    return 1
  }
  const existing = await readdir(folder).catch(() => [] as string[])
  if (existing.length > 0) {
    console.error(`${folder} isn't empty. Pick a new folder.`)
    return 1
  }

  const answers: Answers = {
    id: idFrom(basename(folder)),
    name: name.slice(0, 48),
    author,
    template: picked as Template,
    year: new Date().getFullYear(),
  }
  await mkdir(folder, { recursive: true })
  for (const [file, text] of Object.entries(widgetFiles(answers))) {
    await writeFile(join(folder, file), text)
  }
  const where = relative(process.cwd(), folder) || '.'
  console.info(`\nMade ${answers.name} in ${where}. Next:

  cd ${where}
  npm install
  npm run dev        checks it${answers.template === 'web' ? ' and runs the collector' : ''}, again on every save

To see it on your phone, turn on Developer mode in ShiftPane's Settings, then pick the folder
under Marketplace > Installed > Choose a folder.`)
  return 0
}

function titleOf(folder: string): string {
  const words = folder.replace(/[-_]+/g, ' ').trim()
  return words ? words[0]?.toUpperCase() + words.slice(1) : 'My widget'
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  },
)
