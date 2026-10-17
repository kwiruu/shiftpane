/**
 * Talks to `shiftpane-helper` over its stdin/stdout, one JSON object per line.
 *
 * The message types come from `./bindings`, generated from the Rust protocol by ts-rs, so a
 * change on either side fails typecheck on the other.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { Call, CallResult, HelperError, HelperEvent, Message } from './protocol.ts'

type Method = Call['method']
type ParamsOf<M extends Method> =
  Extract<Call, { method: M }> extends { params: infer P } ? [params: P] : []

/** Which result variant each method answers with. Keep in sync with `dispatch` in server.rs. */
interface ResultTypes {
  'helper.hello': 'hello'
  'display.list': 'displays'
  'display.attach': 'attached'
  'display.prepare': 'prepared'
  'display.detach': 'detached'
  'system.stats': 'systemStats'
  'media.state': 'media'
  'media.control': 'mediaControlled'
}
export type ResultOf<M extends Method> = Extract<CallResult, { type: ResultTypes[M] }>

/**
 * Calls that may sit behind a UAC prompt (Windows adds missing sizes to the driver through an
 * elevated step) and a driver restart, so they get the longer timeout.
 */
const SLOW_METHODS: ReadonlySet<Method> = new Set<Method>(['display.attach', 'display.prepare'])

/** The helper waits up to 120 s for the prompt, then up to 20 s for the driver to reload. */
export const DEFAULT_SLOW_TIMEOUT_MS = 150_000

export class HelperCallError extends Error {
  override readonly name = 'HelperCallError'
  readonly error: HelperError

  constructor(error: HelperError) {
    super(error.message)
    this.error = error
  }
}

interface Pending {
  resolve: (result: CallResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface HelperClientEvents {
  event: [HelperEvent]
  /** A line the client could not match to a request; logged, never thrown. */
  protocolError: [string]
  close: []
}

export class HelperClient extends EventEmitter<HelperClientEvents> {
  readonly #input: Writable
  readonly #timeoutMs: number
  readonly #slowTimeoutMs: number
  #nextId = 1
  #pending = new Map<number, Pending>()
  #closed = false

  constructor(
    input: Writable,
    output: Readable,
    timeoutMs = 10_000,
    slowTimeoutMs = DEFAULT_SLOW_TIMEOUT_MS,
  ) {
    super()
    this.#input = input
    this.#timeoutMs = timeoutMs
    this.#slowTimeoutMs = slowTimeoutMs
    // A helper that dies between our check and our write makes stdin emit EPIPE. The pending
    // calls are failed by the stdout close that follows, so the error itself carries nothing.
    input.on('error', () => {})
    const lines = createInterface({ input: output, crlfDelay: Number.POSITIVE_INFINITY })
    lines.on('line', (line) => this.#onLine(line))
    lines.on('close', () => this.#onClose())
  }

  call<M extends Method>(method: M, ...params: ParamsOf<M>): Promise<ResultOf<M>> {
    if (this.#closed) return Promise.reject(new Error('helper is not running'))
    const id = this.#nextId++
    const request = params.length > 0 ? { id, method, params: params[0] } : { id, method }
    const timeoutMs = SLOW_METHODS.has(method) ? this.#slowTimeoutMs : this.#timeoutMs
    return new Promise<CallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`helper did not answer ${method} within ${timeoutMs} ms`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      this.#input.write(`${JSON.stringify(request)}\n`)
    }) as Promise<ResultOf<M>>
  }

  /** Closes stdin, which makes the helper detach the virtual monitor and exit. */
  close(): void {
    this.#input.end()
  }

  #onLine(line: string): void {
    let message: Message
    try {
      message = JSON.parse(line) as Message
    } catch {
      this.emit('protocolError', line)
      return
    }
    switch (message.kind) {
      case 'event':
        this.emit('event', message.event)
        return
      case 'result':
        this.#settle(message.id, (p) => p.resolve(message.result))
        return
      case 'error':
        if (message.id === null) this.emit('protocolError', message.error.message)
        else this.#settle(message.id, (p) => p.reject(new HelperCallError(message.error)))
        return
      default:
        this.emit('protocolError', line)
    }
  }

  #settle(id: number, settle: (pending: Pending) => void): void {
    const pending = this.#pending.get(id)
    if (!pending) {
      this.emit('protocolError', `reply for unknown request ${id}`)
      return
    }
    clearTimeout(pending.timer)
    this.#pending.delete(id)
    settle(pending)
  }

  #onClose(): void {
    this.#closed = true
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`helper exited before answering request ${id}`))
    }
    this.#pending.clear()
    this.emit('close')
  }
}

export interface SpawnHelperOptions {
  /** One line of the helper's stderr (its log). */
  onLog?: (line: string) => void
  /**
   * The process could not be started (missing file, no permission). The client then closes
   * on its own, failing pending calls; without a listener Node would throw the error.
   */
  onError?: (error: Error) => void
  env?: NodeJS.ProcessEnv
  /** Per-call timeouts, see {@link HelperClient}. */
  timeoutMs?: number
  slowTimeoutMs?: number
}

/** Spawns the helper binary and returns a client bound to it. */
export function spawnHelper(
  binaryPath: string,
  options: SpawnHelperOptions = {},
): { client: HelperClient; process: ChildProcess } {
  const child = spawn(binaryPath, ['serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env,
    windowsHide: true,
  })
  const { onLog, onError } = options
  child.on('error', (error) => onError?.(error))
  if (onLog) createInterface({ input: child.stderr }).on('line', onLog)
  return {
    client: new HelperClient(child.stdin, child.stdout, options.timeoutMs, options.slowTimeoutMs),
    process: child,
  }
}
