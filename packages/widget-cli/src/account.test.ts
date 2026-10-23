import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Api,
  credentialsPath,
  deviceSignIn,
  readCredentials,
  removeCredentials,
  tokenFor,
  upload,
  writeCredentials,
} from './account.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shiftpane-cli-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A pretend marketplace: each path answers from its own list, in turn. */
function fakeApi(answers: Record<string, { status: number; body: Record<string, unknown> }[]>) {
  const calls: { method: string; path: string; token?: string }[] = []
  const api: Api = async (method, path, init = {}) => {
    calls.push({ method, path, token: init.token })
    const next = answers[path]?.shift()
    if (!next) throw new Error(`no answer for ${path}`)
    return next
  }
  return { api, calls }
}

describe('credentials', () => {
  it('keeps the sign-in where each OS keeps settings, readable only by you', async () => {
    expect(
      credentialsPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', 'C:\\Users\\me'),
    ).toBe(join('C:\\Users\\me\\AppData\\Roaming', 'shiftpane', 'credentials.json'))
    expect(credentialsPath({}, 'linux', '/home/me')).toBe(
      join('/home/me', '.config', 'shiftpane', 'credentials.json'),
    )
    expect(credentialsPath({ XDG_CONFIG_HOME: '/cfg' }, 'darwin', '/Users/me')).toBe(
      join('/cfg', 'shiftpane', 'credentials.json'),
    )

    const path = join(dir, 'nested', 'credentials.json')
    await writeCredentials(path, { login: 'octocat', token: 't0ken' })
    expect(await readCredentials(path)).toEqual({ login: 'octocat', token: 't0ken' })
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    await removeCredentials(path)
    expect(await readCredentials(path)).toBeNull()
  })

  it('prefers SHIFTPANE_TOKEN, for CI', async () => {
    const path = join(dir, 'credentials.json')
    await writeCredentials(path, { login: 'octocat', token: 'saved' })
    expect(await tokenFor(path, {})).toBe('saved')
    expect(await tokenFor(path, { SHIFTPANE_TOKEN: ' from-ci ' })).toBe('from-ci')
    expect(await tokenFor(join(dir, 'none.json'), {})).toBeNull()
  })
})

describe('deviceSignIn', () => {
  it('shows the code, waits while it is pending, and slows down when asked', async () => {
    const { api } = fakeApi({
      '/device-code': [
        {
          status: 200,
          body: {
            deviceCode: 'dc',
            userCode: 'ABCD-1234',
            verificationUri: 'x',
            expiresIn: 900,
            interval: 5,
          },
        },
      ],
      '/device-code/token': [
        { status: 202, body: { status: 'pending' } },
        { status: 202, body: { status: 'slow_down', interval: 10 } },
        { status: 200, body: { status: 'done', token: 'tok', user: { login: 'octocat' } } },
      ],
    })
    const said: string[] = []
    const waits: number[] = []
    const signedIn = await deviceSignIn(
      api,
      (line) => said.push(line),
      async (ms) => {
        waits.push(ms)
      },
    )
    expect(signedIn).toEqual({ login: 'octocat', token: 'tok' })
    expect(said).toEqual(['Type ABCD-1234 at https://github.com/login/device'])
    expect(waits).toEqual([5000, 5000, 10_000])
  })

  it('stops when GitHub says no', async () => {
    const { api } = fakeApi({
      '/device-code': [{ status: 200, body: { deviceCode: 'dc', userCode: 'A', interval: 1 } }],
      '/device-code/token': [{ status: 400, body: { status: 'failed', error: 'access_denied' } }],
    })
    await expect(
      deviceSignIn(
        api,
        () => {},
        async () => {},
      ),
    ).rejects.toThrow('access_denied')
  })
})

describe('upload', () => {
  const zip = new Uint8Array([1, 2, 3])

  it('says when the fast lane published it, or that it waits for review', async () => {
    const { api, calls } = fakeApi({
      '/uploads': [
        {
          status: 201,
          body: {
            status: 'approved',
            widgetId: 'w',
            version: '1.0.1',
            fastLane: 'an update with no code',
          },
        },
        { status: 201, body: { status: 'in_review', widgetId: 'w', version: '1.0.2' } },
      ],
    })
    expect(await upload(api, 'tok', zip)).toEqual({
      ok: true,
      status: 'approved',
      widgetId: 'w',
      version: '1.0.1',
      fastLane: 'an update with no code',
    })
    expect(await upload(api, 'tok', zip, 'Fixes')).toMatchObject({ ok: true, status: 'in_review' })
    expect(calls[0]).toEqual({ method: 'POST', path: '/uploads', token: 'tok' })
  })

  it('lists the failed checks, and says when the sign-in ran out', async () => {
    const { api } = fakeApi({
      '/uploads': [
        {
          status: 422,
          body: {
            status: 'failed',
            report: {
              version: { result: 'fail', note: '1.0.0 is already uploaded' },
              size: { result: 'pass' },
            },
          },
        },
        { status: 401, body: { message: 'Sign in first.' } },
      ],
    })
    expect(await upload(api, 'tok', zip)).toEqual({
      ok: false,
      problems: ['1.0.0 is already uploaded'],
    })
    expect(await upload(api, 'tok', zip)).toMatchObject({ ok: false, signedOut: true })
  })
})
