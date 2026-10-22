import { EventEmitter } from 'node:events'
import { API_URL } from '@shiftpane/widget-sdk'
import { z } from 'zod'
import type { AccountState, ShareResult } from '../../shared/widgets.ts'
import type { TextStorage } from '../storage.ts'
import type { Cipher } from './secrets.ts'

/** An answer from the marketplace's API: its status and its JSON (or null). */
export interface ApiAnswer {
  status: number
  body: unknown
}

/** Sends one request to the API. Tests answer from a table instead. */
export type ApiCall = (
  path: string,
  init: { body?: string | FormData; token?: string },
) => Promise<ApiAnswer>

export function apiCall(base = API_URL): ApiCall {
  return async (path, { body, token }) => {
    const headers: Record<string, string> = {}
    if (typeof body === 'string') headers['content-type'] = 'application/json'
    if (token) headers.authorization = `Bearer ${token}`
    const answer = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await answer.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      json = { message: text.slice(0, 300) }
    }
    return { status: answer.status, body: json }
  }
}

const DeviceCode = z.object({
  deviceCode: z.string(),
  userCode: z.string().max(32),
  verificationUri: z.string(),
  expiresIn: z.number(),
  interval: z.number(),
})
const Poll = z.union([
  z.object({ status: z.literal('done'), token: z.string(), user: z.object({ login: z.string() }) }),
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('slow_down'), interval: z.number() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
])
const Saved = z.object({ login: z.string(), token: z.string() })

/** Where GitHub sends people to type the code. Anything else is never opened. */
const GITHUB_DEVICE = /^https:\/\/github\.com\/login\/device\/?$/

export interface AccountOptions {
  storage: TextStorage
  cipher: Cipher
  api?: ApiCall
  /** Opens the GitHub page in the browser. */
  open?: (url: string) => void
  now?: () => number
  log?: (message: string) => void
}

/**
 * Signing in to the marketplace from the app, to share widgets: GitHub's device flow through the
 * marketplace's API (show a code, the user types it on github.com), then a token the app keeps
 * encrypted and sends only to the API.
 */
export class MarketplaceAccount extends EventEmitter<{ change: [AccountState] }> {
  readonly #options: AccountOptions
  #state: AccountState = { status: 'signed-out' }
  #token: string | null = null
  #polling: ReturnType<typeof setTimeout> | undefined

  constructor(options: AccountOptions) {
    super()
    this.#options = options
  }

  get state(): AccountState {
    return this.#state
  }

  #api(): ApiCall {
    return this.#options.api ?? apiCall()
  }

  #now(): number {
    return (this.#options.now ?? Date.now)()
  }

  #set(state: AccountState): void {
    this.#state = state
    this.emit('change', state)
  }

  async load(): Promise<void> {
    try {
      const json = await this.#options.storage.read()
      if (json === null || !this.#options.cipher.available()) return
      const saved = Saved.parse(JSON.parse(json))
      this.#token = this.#options.cipher.decrypt(Buffer.from(saved.token, 'base64'))
      this.#set({ status: 'signed-in', login: saved.login })
    } catch {
      // Unreadable or from another keychain: signed out.
    }
  }

  /** Starts signing in: asks for a code, opens GitHub's page, and waits for the user there. */
  async signIn(): Promise<AccountState> {
    if (!this.#options.cipher.available()) {
      this.#set({
        status: 'signed-out',
        problem: 'This PC has no keychain to keep the sign-in in.',
      })
      return this.#state
    }
    this.cancel()
    let answer: ApiAnswer
    try {
      answer = await this.#api()('/device-code', {})
    } catch (error) {
      this.#set({
        status: 'signed-out',
        problem: `Can't reach the marketplace: ${(error as Error).message}`,
      })
      return this.#state
    }
    const code = DeviceCode.safeParse(answer.body)
    if (answer.status !== 200 || !code.success) {
      this.#set({
        status: 'signed-out',
        problem: messageOf(answer, "The marketplace can't sign you in right now."),
      })
      return this.#state
    }
    const { deviceCode, userCode, verificationUri, expiresIn, interval } = code.data
    const expiresAt = this.#now() + expiresIn * 1000
    this.#set({ status: 'waiting', userCode, verificationUri, expiresAt })
    if (GITHUB_DEVICE.test(verificationUri)) this.#options.open?.(verificationUri)
    this.#poll(deviceCode, interval, expiresAt)
    return this.#state
  }

  #poll(deviceCode: string, interval: number, expiresAt: number): void {
    this.#polling = setTimeout(async () => {
      if (this.#state.status !== 'waiting') return
      if (this.#now() > expiresAt) {
        this.#set({ status: 'signed-out', problem: 'The code expired. Sign in again.' })
        return
      }
      let next = interval
      try {
        const answer = await this.#api()('/device-code/token', {
          body: JSON.stringify({ deviceCode }),
        })
        const poll = Poll.safeParse(answer.body)
        if (this.#state.status !== 'waiting') return
        if (!poll.success) throw new Error(messageOf(answer, 'unexpected answer'))
        if (poll.data.status === 'done') {
          await this.#keep(poll.data.user.login, poll.data.token)
          return
        }
        if (poll.data.status === 'failed') {
          this.#set({ status: 'signed-out', problem: `GitHub said: ${poll.data.error}` })
          return
        }
        if (poll.data.status === 'slow_down') next = poll.data.interval
      } catch (error) {
        this.#options.log?.(`sign-in: ${(error as Error).message}`)
      }
      this.#poll(deviceCode, next, expiresAt)
    }, interval * 1000)
  }

  async #keep(login: string, token: string): Promise<void> {
    this.#token = token
    const sealed = this.#options.cipher.encrypt(token).toString('base64')
    await this.#options.storage.write(JSON.stringify({ login, token: sealed }))
    this.#set({ status: 'signed-in', login })
  }

  /** Stops waiting for the user on GitHub. */
  cancel(): void {
    clearTimeout(this.#polling)
    this.#polling = undefined
    if (this.#state.status === 'waiting') this.#set({ status: 'signed-out' })
  }

  async signOut(): Promise<void> {
    this.cancel()
    this.#token = null
    await this.#options.storage.write('null').catch(() => {})
    this.#set({ status: 'signed-out' })
  }

  /** Uploads a packed widget for review, as the signed-in author. */
  async upload(zip: Uint8Array, notes = ''): Promise<ShareResult> {
    if (!this.#token) return { ok: false, problems: ['Sign in to the marketplace first.'] }
    const form = new FormData()
    form.append('package', new Blob([zip], { type: 'application/zip' }), 'package.zip')
    if (notes) form.append('notes', notes.slice(0, 500))
    let answer: ApiAnswer
    try {
      answer = await this.#api()('/uploads', { body: form, token: this.#token })
    } catch (error) {
      return { ok: false, problems: [`Can't reach the marketplace: ${(error as Error).message}`] }
    }
    if (answer.status === 201) {
      const done = z
        .object({ status: z.string(), widgetId: z.string(), version: z.string() })
        .safeParse(answer.body)
      if (done.success) return { ok: true, ...done.data }
    }
    if (answer.status === 401) {
      await this.signOut()
      return { ok: false, problems: ['The sign-in ran out. Sign in again.'] }
    }
    const report = z
      .object({
        report: z.record(z.string(), z.object({ result: z.string(), note: z.string().optional() })),
      })
      .safeParse(answer.body)
    if (answer.status === 422 && report.success) {
      const failed = Object.values(report.data.report)
        .filter((check) => check.result === 'fail')
        .map((check) => check.note ?? 'A check failed.')
      return { ok: false, problems: failed.length > 0 ? failed : ['The marketplace refused it.'] }
    }
    return {
      ok: false,
      problems: [messageOf(answer, `The marketplace answered ${answer.status}.`)],
    }
  }
}

function messageOf(answer: ApiAnswer, fallback: string): string {
  const body = answer.body as { message?: unknown; error?: unknown } | null
  const text = body?.message ?? body?.error
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 300) : fallback
}
