/**
 * The files a new widget starts with. Two templates: `pc` reads the PC's own sources and needs
 * no code; `web` has a collector that fetches JSON from one host.
 */

export const templates = ['pc', 'web'] as const
export type Template = (typeof templates)[number]

export interface Answers {
  id: string
  name: string
  /** The author's GitHub login: the marketplace takes uploads only from that account. */
  author: string
  template: Template
  year: number
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const SCHEMA = 'https://unpkg.com/@shiftpane/widget-sdk/schema/widget-manifest.schema.json'

function manifest(answers: Answers) {
  const base = {
    $schema: SCHEMA,
    id: answers.id,
    name: answers.name,
    version: '0.1.0',
    author: answers.author,
    license: 'MIT',
    minAppVersion: '0.5.0',
  }
  if (answers.template === 'pc') {
    return {
      ...base,
      description: 'CPU load as a ring, with the last minute beside it.',
      categories: ['system'],
      sizes: ['small', 'medium'],
      permissions: { sources: ['cpu'] },
    }
  }
  return {
    ...base,
    description: 'Stars and open issues on one GitHub repository.',
    categories: ['dev'],
    sizes: ['small', 'medium'],
    refreshSeconds: 600,
    permissions: { network: ['api.github.com'], secrets: ['GITHUB_TOKEN'] },
    config: [
      {
        key: 'repo',
        label: 'Repository',
        type: 'string',
        required: true,
        default: 'kwiruu/shiftpane',
        help: 'owner/name, such as kwiruu/shiftpane.',
      },
    ],
  }
}

function view(template: Template) {
  if (template === 'pc') {
    return {
      small: {
        type: 'stack',
        align: 'between',
        children: [
          { type: 'label', text: 'CPU' },
          { type: 'ring', bind: '@cpu/percent' },
        ],
      },
      medium: {
        type: 'row',
        gap: 5,
        children: [
          { type: 'ring', bind: '@cpu/percent', label: 'CPU' },
          {
            type: 'stack',
            align: 'between',
            children: [
              { type: 'label', text: 'Last minute' },
              { type: 'history-bars', bind: '@cpu/history', max: 100 },
            ],
          },
        ],
      },
    }
  }
  return {
    small: {
      type: 'stack',
      align: 'between',
      children: [
        {
          type: 'row',
          align: 'between',
          children: [
            { type: 'label', text: '{config.repo}' },
            { type: 'icon', name: 'star' },
          ],
        },
        {
          type: 'stack',
          gap: 0.5,
          children: [
            { type: 'value', bind: '/stars', format: 'compact', size: 'xl' },
            { type: 'label', text: 'stars' },
          ],
        },
      ],
    },
    medium: {
      type: 'stack',
      align: 'between',
      children: [
        { type: 'label', text: '{config.repo}' },
        {
          type: 'grid',
          columns: 2,
          children: [
            {
              type: 'stack',
              gap: 0.5,
              children: [
                { type: 'value', bind: '/stars', format: 'compact', size: 'lg' },
                { type: 'label', text: 'stars' },
              ],
            },
            {
              type: 'stack',
              gap: 0.5,
              children: [
                { type: 'value', bind: '/issues', format: 'compact', size: 'lg' },
                { type: 'label', text: 'open issues' },
              ],
            },
          ],
        },
      ],
    },
  }
}

const COLLECTOR = `import { defineCollector } from '@shiftpane/widget-sdk'

// Runs on the PC every refreshSeconds while a phone shows the widget, in a sandbox: it can reach
// only the hosts in manifest.json, and gets only the secrets listed there. What it returns is
// what view.json's "/..." bindings read; sample.json is an example of it.
export default defineCollector(async ({ config, secrets, fetch }) => {
  const headers = { Accept: 'application/vnd.github+json' }
  if (secrets.GITHUB_TOKEN) headers.Authorization = \`Bearer \${secrets.GITHUB_TOKEN}\`
  const answer = await fetch(\`https://api.github.com/repos/\${config.repo}\`, { headers })
  if (!answer.ok) throw new Error(\`GitHub answered \${answer.status}\`)
  const repo = await answer.json()
  return { stars: repo.stargazers_count, issues: repo.open_issues_count }
})
`

function readme(answers: Answers): string {
  const run =
    answers.template === 'web'
      ? 'npx shiftpane-widget dev --config repo=kwiruu/shiftpane'
      : 'npx shiftpane-widget dev'
  return `# ${answers.name}

${answers.template === 'pc' ? 'CPU load as a ring, with the last minute beside it.' : 'Stars and open issues on one GitHub repository.'}

## Make it yours

- \`manifest.json\` says what the widget is and what it may touch.
- \`view.json\` is how the phone draws it, one tree per size.
- \`sample.json\` is an example of the data the view reads${answers.template === 'web' ? '\n- `collector.js` fetches that data on your PC' : ''}.

\`\`\`sh
${run}       # checks it${answers.template === 'web' ? ' and runs the collector' : ''}, again on every save
npx shiftpane-widget pack      # the zip to upload at https://shiftpane.vercel.app/upload
\`\`\`

To see it on your phone, turn on Developer mode in ShiftPane's Settings, then pick this folder
under Marketplace > Installed > Choose a folder. It reloads when you save.
`
}

function license(answers: Answers): string {
  return `MIT License

Copyright (c) ${answers.year} ${answers.author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
}

/** Every file of a new widget, by name. */
export function widgetFiles(answers: Answers): Record<string, string> {
  const files: Record<string, string> = {
    'manifest.json': json(manifest(answers)),
    'view.json': json(view(answers.template)),
    'sample.json': json(answers.template === 'pc' ? {} : { stars: 1240, issues: 18 }),
    'README.md': readme(answers),
    LICENSE: license(answers),
    'package.json': json({
      name: answers.id,
      private: true,
      type: 'module',
      scripts: {
        dev: 'shiftpane-widget dev',
        validate: 'shiftpane-widget validate',
        pack: 'shiftpane-widget pack',
      },
      devDependencies: { '@shiftpane/widget-sdk': '^0.5.0', 'shiftpane-widget': '^0.5.0' },
    }),
    '.gitignore': 'node_modules/\n*.zip\n',
  }
  if (answers.template === 'web') files['collector.js'] = COLLECTOR
  return files
}

/** A widget id from a name: lowercase letters, digits and dashes. */
export function idFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'my-widget'
  )
}
