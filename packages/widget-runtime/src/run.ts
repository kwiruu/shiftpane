/// <reference path="./webassembly.d.ts" />
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import type { JsonValue } from '@shiftpane/widget-sdk'
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'

/**
 * Runs a widget's collector.js: code from a stranger, on the user's PC. It runs in QuickJS
 * compiled to WebAssembly, not in Node: there is no `require`, no filesystem, no process and no
 * network except the `fetch` the app hands in, which decides what may be reached. Every run gets a
 * fresh interpreter, so nothing carries over from one run to the next.
 *
 * Runs share one WebAssembly instance, whose memory has a hard ceiling: past it, the collector's
 * allocations fail as "out of memory". (QuickJS's own memory limit can't count allocations in
 * this build, so the ceiling is the limit.) Run collectors one at a time, or one greedy collector
 * can make another run out of memory too.
 */

/** The sandbox's memory, QuickJS itself included: a collector gets about 32 MB of it. */
const MEMORY_CEILING = 48 * 1024 * 1024
/** Past this, the next run starts on a fresh instance, so one greedy run doesn't keep it big. */
const MEMORY_RESET = 24 * 1024 * 1024
const PAGE = 64 * 1024

export interface RunLimits {
  /** Wall clock for the whole run, waiting on `fetch` included. */
  timeoutMs: number
  /**
   * The longest the collector may compute without yielding. Collectors run on the app's main
   * thread between other work, so a busy loop is cut short here rather than at the timeout.
   */
  sliceMs: number
  /** The returned JSON, at most. */
  outputBytes: number
  /** Requests per run, at most. */
  fetches: number
}

export const DEFAULT_LIMITS: RunLimits = {
  timeoutMs: 10_000,
  sliceMs: 250,
  outputBytes: 64 * 1024,
  fetches: 16,
}

export interface HostRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface HostResponse {
  status: number
  statusText: string
  /** Where the answer came from, after any redirects. */
  url: string
  /** Lowercase names. */
  headers: Record<string, string>
  body: string
}

/**
 * The only way out of the sandbox. The app's implementation checks each request against the
 * widget's permissions; whatever it throws reaches the collector as a rejected `fetch`.
 */
export type HostFetch = (request: HostRequest, signal: AbortSignal) => Promise<HostResponse>

export interface RunInput {
  /** collector.js: an ES module whose default export is the collector. */
  code: string
  config: Record<string, unknown>
  secrets: Record<string, string>
  /** A snapshot of the sources the widget declared. */
  sources: Record<string, unknown>
  fetch: HostFetch
  log?: (message: string) => void
  limits?: Partial<RunLimits>
}

export type RunResult =
  | { ok: true; output: Record<string, JsonValue> }
  | { ok: false; error: string }

const SDK_MODULE = '@shiftpane/widget-sdk'

/** The SDK as a collector sees it: only `defineCollector`, which hands back what it is given. */
const SDK_SOURCE = 'export const defineCollector = (collector) => collector\n'

/**
 * What the collector gets besides its own code: `fetch` (in the context) shaped like the
 * browser's for the JSON and text APIs it will call, and `console`, both on top of two host
 * functions. Runs once per interpreter, before the collector.
 */
const PRELUDE = `
const hostFetch = globalThis.__hostFetch
const hostLog = globalThis.__hostLog
delete globalThis.__hostFetch
delete globalThis.__hostLog
const say = (...parts) => hostLog(parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join(' '))
globalThis.console = { log: say, info: say, warn: say, error: say, debug: say }
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) freeze(value[key])
  }
  return value
}
const respond = (raw) => {
  const answer = JSON.parse(raw)
  return Object.freeze({
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    statusText: answer.statusText,
    url: answer.url,
    headers: Object.freeze({
      get: (name) => {
        const value = answer.headers[String(name).toLowerCase()]
        return value === undefined ? null : value
      },
    }),
    text: async () => answer.body,
    json: async () => JSON.parse(answer.body),
  })
}
const fetch = async (url, init = {}) => {
  const headers = {}
  for (const [name, value] of Object.entries(init.headers ?? {})) headers[name] = String(value)
  const request = { url: String(url), method: String(init.method ?? 'GET').toUpperCase(), headers }
  if (init.body !== undefined) request.body = String(init.body)
  return respond(await hostFetch(JSON.stringify(request)))
}
globalThis.__run = async (collect, input) => {
  if (typeof collect !== 'function') {
    throw new Error('collector.js has to export a collector: export default defineCollector(...)')
  }
  const context = JSON.parse(input)
  const output = await collect(
    Object.freeze({
      config: freeze(context.config),
      secrets: freeze(context.secrets),
      sources: freeze(context.sources),
      fetch,
      signal: Object.freeze({ aborted: false }),
      log: (message) => hostLog(String(message)),
    }),
  )
  return JSON.stringify(output === undefined ? null : output)
}
`

let quickjs: Promise<QuickJSWASMModule> | undefined

/** Loads QuickJS, once until a run leaves it big; a load takes a moment. */
export function loadRuntime(): Promise<QuickJSWASMModule> {
  quickjs ??= newQuickJSWASMModuleFromVariant(
    newVariant(variant, {
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: MEMORY_CEILING / PAGE }),
    }),
  )
  return quickjs
}

/** After a run: a module whose memory grew a lot is dropped, and its memory with it. */
function shrink(module: QuickJSWASMModule, loaded: Promise<QuickJSWASMModule>): void {
  if (module.getWasmMemory().buffer.byteLength > MEMORY_RESET && quickjs === loaded) {
    quickjs = undefined
  }
}

class RunError extends Error {}

/** Runs a collector once and returns what it collected, or why it couldn't. */
export async function runCollector(input: RunInput): Promise<RunResult> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  const loaded = loadRuntime()
  const module = await loaded
  const runtime = module.newRuntime()
  const abort = new AbortController()
  const started = Date.now()
  let sliceEnds = 0
  let finished = false
  let context: QuickJSContext | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  runtime.setMemoryLimit(MEMORY_CEILING)
  runtime.setMaxStackSize(512 * 1024)
  runtime.setInterruptHandler(() => {
    const now = Date.now()
    return now > sliceEnds || now - started > limits.timeoutMs
  })
  runtime.setModuleLoader((name) => {
    if (name === SDK_MODULE) return SDK_SOURCE
    return {
      error: new Error(
        `collector.js can only import defineCollector from ${SDK_MODULE}, not ${JSON.stringify(name)}`,
      ),
    }
  })

  /** Runs the interpreter for one slice of time. */
  const slice = <T>(work: () => T): T => {
    sliceEnds = Date.now() + limits.sliceMs
    return work()
  }

  /** Runs whatever the collector queued (its awaits and callbacks), one slice of time. */
  const pump = (vm: QuickJSRuntime) => {
    const result = slice(() => vm.executePendingJobs())
    if (result.error) {
      const error = context?.dump(result.error)
      result.error.dispose()
      throw new RunError(describe(error))
    }
  }

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort()
      reject(new RunError(`it took longer than ${limits.timeoutMs / 1000} s`))
    }, limits.timeoutMs)
  })

  try {
    const vm = runtime.newContext()
    context = vm
    let fetches = 0

    const hostFetch = vm.newFunction('__hostFetch', (requestHandle) => {
      const deferred = vm.newPromise()
      const settle = (work: () => void) => {
        if (finished) return
        work()
        deferred.settled.then(() => {
          if (!finished) {
            try {
              pump(runtime)
            } catch {
              // The run's own promise reports what went wrong.
            }
          }
        })
      }
      fetches += 1
      if (fetches > limits.fetches) {
        settle(() => {
          const error = vm.newError(`a collector may make ${limits.fetches} requests per run`)
          deferred.reject(error)
          error.dispose()
        })
        return deferred.handle
      }
      let request: HostRequest
      try {
        request = JSON.parse(vm.getString(requestHandle)) as HostRequest
      } catch {
        settle(() => {
          const error = vm.newError('fetch got a request it could not read')
          deferred.reject(error)
          error.dispose()
        })
        return deferred.handle
      }
      input.fetch(request, abort.signal).then(
        (response) =>
          settle(() => {
            const text = vm.newString(JSON.stringify(response))
            deferred.resolve(text)
            text.dispose()
          }),
        (error: unknown) =>
          settle(() => {
            const handle = vm.newError(error instanceof Error ? error.message : String(error))
            deferred.reject(handle)
            handle.dispose()
          }),
      )
      return deferred.handle
    })
    vm.setProp(vm.global, '__hostFetch', hostFetch)
    hostFetch.dispose()

    const hostLog = vm.newFunction('__hostLog', (messageHandle) => {
      input.log?.(vm.getString(messageHandle).slice(0, 2000))
    })
    vm.setProp(vm.global, '__hostLog', hostLog)
    hostLog.dispose()

    vm.unwrapResult(slice(() => vm.evalCode(PRELUDE, 'prelude.js', { type: 'global' }))).dispose()

    // The collector's module: its exports, or a promise of them if it awaits at the top level.
    const evaluated = slice(() => vm.evalCode(input.code, 'collector.js', { type: 'module' }))
    if (evaluated.error) {
      const error = vm.dump(evaluated.error)
      evaluated.error.dispose()
      throw new RunError(describe(error))
    }
    const exports = await settled(vm, runtime, evaluated.value, pump, timeout)
    const collect = vm.getProp(exports, 'default')
    exports.dispose()

    const run = vm.getProp(vm.global, '__run')
    const contextJson = vm.newString(
      JSON.stringify({ config: input.config, secrets: input.secrets, sources: input.sources }),
    )
    const called = slice(() => vm.callFunction(run, vm.undefined, collect, contextJson))
    run.dispose()
    collect.dispose()
    contextJson.dispose()
    if (called.error) {
      const error = vm.dump(called.error)
      called.error.dispose()
      throw new RunError(describe(error))
    }
    const outputHandle = await settled(vm, runtime, called.value, pump, timeout)
    const json = vm.getString(outputHandle)
    outputHandle.dispose()

    if (json.length > limits.outputBytes) {
      throw new RunError(`it returned more than ${Math.round(limits.outputBytes / 1024)} KB`)
    }
    const output: unknown = JSON.parse(json)
    if (output === null || typeof output !== 'object' || Array.isArray(output)) {
      throw new RunError('it has to return a JSON object')
    }
    return { ok: true, output: output as Record<string, JsonValue> }
  } catch (error) {
    return { ok: false, error: error instanceof RunError ? error.message : describe(error) }
  } finally {
    finished = true
    clearTimeout(timer)
    abort.abort()
    try {
      context?.dispose()
      runtime.dispose()
    } catch {
      // A run cut off mid-way can leave handles behind; the interpreter goes with the runtime.
    }
    shrink(module, loaded)
  }
}

/**
 * The value a handle settles to (itself, or what the promise it holds resolves to) once the
 * collector's queued work has run, as long as the run's time lasts. Takes the handle.
 */
async function settled(
  vm: QuickJSContext,
  runtime: QuickJSRuntime,
  handle: QuickJSHandle,
  pump: (runtime: QuickJSRuntime) => void,
  timeout: Promise<never>,
): Promise<QuickJSHandle> {
  const resolved = vm.resolvePromise(handle)
  handle.dispose()
  pump(runtime)
  const result = await Promise.race([resolved, timeout])
  if (result.error) {
    const error = vm.dump(result.error)
    result.error.dispose()
    throw new RunError(describe(error))
  }
  return result.value
}

/** An error from inside the interpreter, as one line. */
function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const { name, message } = error as { name?: unknown; message?: unknown }
    if (name === 'InternalError' && message === 'interrupted') return 'it ran for too long'
    if (typeof message === 'string') {
      if (/out of memory/i.test(message)) return 'it used too much memory'
      return typeof name === 'string' && name !== 'Error' ? `${name}: ${message}` : message
    }
  }
  return String(error)
}
