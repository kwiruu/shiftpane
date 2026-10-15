import { EventEmitter } from 'node:events'
import type { HelloInfo, HelperClient } from '@shiftpane/helper-client'
import type { LocateResult } from './locate.ts'

/** The slice of {@link HelperClient} the display code uses, so tests can script the helper. */
export interface HelperChannel {
  call: HelperClient['call']
  /** Closes the helper's stdin: it detaches the monitor and exits. */
  close(): void
}

export interface OpenedHelper {
  channel: HelperChannel
  /** Settles once the helper process is gone, however it went. */
  closed: Promise<void>
  /** Ends the process without waiting for it to notice stdin closing. */
  kill(): void
}

export interface OpenHooks {
  onLog(line: string): void
  /** The process could not be started. */
  onError(error: Error): void
}

export type HelperFailure =
  /** No helper executable to run. */
  | 'not-found'
  /** The executable exists but the OS refused to start it. */
  | 'start-failed'
  /** Started, but it did not answer `helper.hello`. */
  | 'no-reply'
  /** Answered with a protocol version this app does not speak. */
  | 'outdated'
  /** The app is shutting down. */
  | 'stopped'

export class HelperUnavailableError extends Error {
  override readonly name = 'HelperUnavailableError'
  readonly reason: HelperFailure

  constructor(reason: HelperFailure, message: string) {
    super(message)
    this.reason = reason
  }
}

export interface HelperSession {
  channel: HelperChannel
  /** The handshake answer from when the helper started. */
  hello: HelloInfo
}

export interface HelperHostOptions {
  locate(): LocateResult
  open(path: string, hooks: OpenHooks): OpenedHelper
  /** `HELPER_PROTOCOL_VERSION`; a helper that answers with another number is refused. */
  expectedProtocol: number
  log?: (line: string) => void
  /** How long `stop` waits for the helper to exit after closing its stdin. */
  stopTimeoutMs?: number
}

/**
 * Owns the one helper process: starts it on first use, checks it speaks our protocol, and
 * starts a fresh one after it exits. It does not retry on its own; the next caller of
 * {@link session} does, so a helper that dies on every request cannot spin.
 */
export class HelperHost extends EventEmitter<{ exit: [] }> {
  readonly #options: HelperHostOptions
  #session: Promise<HelperSession> | null = null
  #current: OpenedHelper | null = null
  #stopped = false

  constructor(options: HelperHostOptions) {
    super()
    this.#options = options
  }

  /** Resolves once a helper is running and has passed the handshake. */
  session(): Promise<HelperSession> {
    if (this.#stopped) {
      return Promise.reject(new HelperUnavailableError('stopped', 'ShiftPane is shutting down'))
    }
    this.#session ??= this.#start().catch((error: unknown) => {
      this.#session = null
      throw error
    })
    return this.#session
  }

  async #start(): Promise<HelperSession> {
    const located = this.#options.locate()
    if (located.path === null) throw new HelperUnavailableError('not-found', located.message)

    let startError: Error | null = null
    const opened = this.#options.open(located.path, {
      onLog: (line) => this.#options.log?.(`helper: ${line}`),
      onError: (error) => {
        startError = error
        this.#options.log?.(`helper failed to start: ${error.message}`)
      },
    })
    this.#current = opened
    void opened.closed.then(() => {
      if (this.#current !== opened) return
      this.#current = null
      this.#session = null
      this.emit('exit')
    })

    let hello: HelloInfo
    try {
      hello = await opened.channel.call('helper.hello')
    } catch (error) {
      // Forget it before it exits, so its exit is not reported as a running helper dying.
      this.#current = null
      opened.kill()
      const failure = startError as Error | null
      if (failure) {
        throw new HelperUnavailableError(
          'start-failed',
          `The display helper could not be started: ${failure.message}`,
        )
      }
      throw new HelperUnavailableError(
        'no-reply',
        `The display helper did not answer: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (hello.protocolVersion !== this.#options.expectedProtocol) {
      this.#current = null
      opened.kill()
      throw new HelperUnavailableError(
        'outdated',
        `The display helper speaks protocol ${hello.protocolVersion} but this app needs ` +
          `${this.#options.expectedProtocol}. Reinstall ShiftPane, or run \`cargo build -p shiftpane-helper\` when running from source.`,
      )
    }
    return { channel: opened.channel, hello }
  }

  /** Closes the helper's stdin so it removes the monitor, then waits for it to exit. */
  async stop(): Promise<void> {
    this.#stopped = true
    const opened = this.#current
    this.#current = null
    this.#session = null
    if (!opened) return
    opened.channel.close()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.#options.stopTimeoutMs ?? 5_000)
    })
    const outcome = await Promise.race([opened.closed.then(() => 'closed' as const), timedOut])
    clearTimeout(timer)
    if (outcome === 'timeout') opened.kill()
  }
}
