import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextStorage } from '../storage.ts'
import { type ApiCall, MarketplaceAccount } from './account.ts'
import type { Cipher } from './secrets.ts'

const cipher: Cipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(`sealed:${text}`),
  decrypt: (data) => data.toString().replace(/^sealed:/, ''),
}

function memory(): TextStorage & { text: string | null } {
  const store = {
    text: null as string | null,
    read: async () => store.text,
    write: async (text: string) => {
      store.text = text
    },
  }
  return store
}

const code = {
  deviceCode: 'dc',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MarketplaceAccount', () => {
  it('signs in with a code typed on GitHub, and keeps the token sealed', async () => {
    const polls = [
      { status: 'pending' },
      { status: 'done', token: 'tok', user: { login: 'kwiruu' } },
    ]
    const api = vi.fn<ApiCall>(async (path) =>
      path === '/device-code' ? { status: 200, body: code } : { status: 202, body: polls.shift() },
    )
    const open = vi.fn()
    const storage = memory()
    const account = new MarketplaceAccount({ storage, cipher, api, open })
    expect(await account.signIn()).toMatchObject({ status: 'waiting', userCode: 'ABCD-1234' })
    expect(open).toHaveBeenCalledWith('https://github.com/login/device')
    await vi.advanceTimersByTimeAsync(5000)
    expect(account.state.status).toBe('waiting')
    await vi.advanceTimersByTimeAsync(5000)
    expect(account.state).toEqual({ status: 'signed-in', login: 'kwiruu' })
    expect(storage.text).not.toContain('"tok"')

    const again = new MarketplaceAccount({ storage, cipher, api })
    await again.load()
    expect(again.state).toEqual({ status: 'signed-in', login: 'kwiruu' })
  })

  it('never opens a page that is not GitHub', async () => {
    const api: ApiCall = async () => ({
      status: 200,
      body: { ...code, verificationUri: 'https://evil.example.com/login/device' },
    })
    const open = vi.fn()
    await new MarketplaceAccount({ storage: memory(), cipher, api, open }).signIn()
    expect(open).not.toHaveBeenCalled()
  })

  it('uploads as the signed-in author and says why the marketplace refused', async () => {
    const storage = memory()
    storage.text = JSON.stringify({
      login: 'kwiruu',
      token: Buffer.from('sealed:tok').toString('base64'),
    })
    const answers = [
      {
        status: 201,
        body: { status: 'in_review', id: 'v1', widgetId: 'my-widget', version: '1.0.0' },
      },
      {
        status: 422,
        body: {
          status: 'failed',
          report: {
            manifest: { result: 'fail', note: '"author" has to be your GitHub login, kwiruu.' },
            view: { result: 'pass' },
          },
        },
      },
      { status: 401, body: { message: 'Sign in first.' } },
    ]
    const api = vi.fn<ApiCall>(async () => answers.shift() ?? { status: 500, body: null })
    const account = new MarketplaceAccount({ storage, cipher, api })
    await account.load()
    const zip = new Uint8Array([1, 2, 3])
    expect(await account.upload(zip, 'First version')).toEqual({
      ok: true,
      status: 'in_review',
      widgetId: 'my-widget',
      version: '1.0.0',
    })
    expect(api.mock.calls[0]?.[1].token).toBe('tok')
    expect(await account.upload(zip)).toEqual({
      ok: false,
      problems: ['"author" has to be your GitHub login, kwiruu.'],
    })
    expect(await account.upload(zip)).toEqual({
      ok: false,
      problems: ['The sign-in ran out. Sign in again.'],
    })
    expect(account.state.status).toBe('signed-out')
  })
})
