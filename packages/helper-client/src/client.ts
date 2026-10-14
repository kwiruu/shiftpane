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
  'display.detach': 'detached'
}
export type ResultOf<M extends Method> = Extract<CallResult, { type: ResultTypes[M] }>

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
  #nextId = 1
  #pending = new Map<number, Pending>()
  #closed = false

  constructor(input: Writable, output: Readable, timeoutMs = 10_000) {
    super()
    this.#input = input
    this.#timeoutMs = timeoutMs
    const lines = createInterface({ input: output, crlfDelay: Number.POSITIVE_INFINITY })
    lines.on('line', (line) => this.#onLine(line))
    lines.on('close', () => this.#onClose())
  }

  call<M extends Method>(method: M, ...params: ParamsOf<M>): Promise<ResultOf<M>> {
    if (this.#closed) return Promise.reject(new Error('helper is not running'))
    const id = this.#nextId++
    const request = params.length > 0 ? { id, method, params: params[0] } : { id, method }
    return new Promise<CallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`helper did not answer ${method} within ${this.#timeoutMs} ms`))
      }, this.#timeoutMs)
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

/** Spawns the helper binary and returns a client bound to it. stderr is forwarded to `onLog`. */
export function spawnHelper(
  binaryPath: string,
  options: { onLog?: (line: string) => void; env?: NodeJS.ProcessEnv } = {},
): { client: HelperClient; process: ChildProcess } {
  const child = spawn(binaryPath, ['serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env,
    windowsHide: true,
  })
  const { onLog } = options
  if (onLog) createInterface({ input: child.stderr }).on('line', onLog)
  return { client: new HelperClient(child.stdin, child.stdout), process: child }
}
