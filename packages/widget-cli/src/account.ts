import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { API_URL } from '@shiftpane/widget-sdk'

/**
 * Signing the CLI in to the marketplace and uploading with it: the same device flow and token the
 * desktop app uses. GitHub shows a code to type, the marketplace answers with a token, and the
 * token goes in a file only you can read (or, for CI, in `SHIFTPANE_TOKEN`).
 */

export interface Credentials {
  login: string
  token: string
}

/** Where the sign-in is kept: `%APPDATA%\shiftpane` on Windows, `~/.config/shiftpane` elsewhere. */
export function credentialsPath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const base =
    platform === 'win32'
      ? (env.APPDATA ?? join(home, 'AppData', 'Roaming'))
      : (env.XDG_CONFIG_HOME ?? join(home, '.config'))
  return join(base, 'shiftpane', 'credentials.json')
}

export async function readCredentials(path: string): Promise<Credentials | null> {
  try {
    const saved = JSON.parse(await readFile(path, 'utf8')) as Partial<Credentials>
    return typeof saved.login === 'string' && typeof saved.token === 'string'
      ? { login: saved.login, token: saved.token }
      : null
  } catch {
    return null
  }
}

export async function writeCredentials(path: string, credentials: Credentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(credentials)}\n`, { mode: 0o600 })
}

export async function removeCredentials(path: string): Promise<void> {
  await rm(path, { force: true })
}

/** The token to use: `SHIFTPANE_TOKEN` first, for CI, then the saved sign-in. */
export async function tokenFor(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  return env.SHIFTPANE_TOKEN?.trim() || (await readCredentials(path))?.token || null
}

export interface Answer {
  status: number
  body: Record<string, unknown>
}

/** One call to the marketplace's API. */
export type Api = (
  method: 'GET' | 'POST',
  path: string,
  init?: { json?: unknown; form?: FormData; token?: string },
) => Promise<Answer>

export function marketplaceApi(base = process.env.SHIFTPANE_API ?? API_URL, fetcher = fetch): Api {
  return async (method, path, init = {}) => {
    const headers: Record<string, string> = {}
    if (init.token) headers.authorization = `Bearer ${init.token}`
    let body: string | FormData | undefined = init.form
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    }
    const response = await fetcher(`${base}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { message: text.slice(0, 300) }
    }
    const record =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
    return { status: response.status, body: record }
  }
}

const message = (answer: Answer, fallback: string) =>
  typeof answer.body.message === 'string' ? answer.body.message : fallback

/** Where GitHub sends people to type the code. */
const GITHUB_DEVICE = 'https://github.com/login/device'

/**
 * GitHub's device flow through the marketplace: shows a code and where to type it, then waits
 * until it's typed (or runs out).
 */
export async function deviceSignIn(
  api: Api,
  say: (line: string) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<Credentials> {
  const start = await api('POST', '/device-code', { json: {} })
  if (start.status !== 200)
    throw new Error(message(start, `The marketplace answered ${start.status}.`))
  const { deviceCode, userCode, expiresIn } = start.body
  let interval = Number(start.body.interval) || 5
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string') {
    throw new Error('The marketplace sent no code.')
  }
  say(`Type ${userCode} at ${GITHUB_DEVICE}`)
  const deadline = Date.now() + (Number(expiresIn) || 900) * 1000
  while (Date.now() < deadline) {
    await wait(interval * 1000)
    const poll = await api('POST', '/device-code/token', { json: { deviceCode } })
    const status = poll.body.status
    if (poll.status === 200 && status === 'done') {
      const user = poll.body.user as { login?: unknown } | undefined
      if (typeof poll.body.token !== 'string' || typeof user?.login !== 'string') {
        throw new Error('The marketplace sent no token.')
      }
      return { login: user.login, token: poll.body.token }
    }
    if (status === 'slow_down') interval = Number(poll.body.interval) || interval + 5
    else if (status !== 'pending')
      throw new Error(`GitHub said: ${String(poll.body.error ?? status)}`)
  }
  throw new Error('The code ran out before it was typed. Run login again.')
}

export type UploadResult =
  | { ok: true; status: string; widgetId: string; version: string; fastLane?: string }
  | { ok: false; problems: string[]; signedOut?: boolean }

/** Uploads a packed widget for review, as the token's account. */
export async function upload(
  api: Api,
  token: string,
  zip: Uint8Array,
  notes = '',
): Promise<UploadResult> {
  const form = new FormData()
  form.append('package', new Blob([zip.slice()], { type: 'application/zip' }), 'package.zip')
  if (notes) form.append('notes', notes.slice(0, 500))
  const answer = await api('POST', '/uploads', { form, token })
  const { status, widgetId, version, fastLane } = answer.body
  if (
    answer.status === 201 &&
    typeof status === 'string' &&
    typeof widgetId === 'string' &&
    typeof version === 'string'
  ) {
    return {
      ok: true,
      status,
      widgetId,
      version,
      ...(typeof fastLane === 'string' ? { fastLane } : {}),
    }
  }
  if (answer.status === 401) {
    return { ok: false, signedOut: true, problems: ['The sign-in ran out. Run login again.'] }
  }
  const report = answer.body.report as
    | Record<string, { result?: string; note?: string }>
    | undefined
  if (answer.status === 422 && report) {
    const failed = Object.values(report)
      .filter((check) => check.result === 'fail')
      .map((check) => check.note ?? 'A check failed.')
    return { ok: false, problems: failed.length > 0 ? failed : ['The marketplace refused it.'] }
  }
  return { ok: false, problems: [message(answer, `The marketplace answered ${answer.status}.`)] }
}
