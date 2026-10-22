import type { Sources } from './sources.ts'

/**
 * Collectors run on the PC on a timer and return plain JSON for the widget's view.
 *
 * They run in a sandbox (`@shiftpane/widget-runtime`) and receive only what their manifest
 * declared: the sources in `permissions.sources`, a `fetch` limited to `permissions.network` and
 * `permissions.local`, and the secrets in `permissions.secrets`. The return value must be
 * JSON-serialisable and at most 64 KB; it is sent to the phone as-is.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** What the sandbox's `fetch` answers: enough of a `Response` for JSON and text APIs. */
export interface CollectorResponse {
  ok: boolean
  status: number
  statusText: string
  url: string
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
}

export interface CollectorRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  headers?: Record<string, string>
  body?: string
  signal?: unknown
}

export interface CollectorContext<Config, Secrets extends string> {
  config: Readonly<Config>
  secrets: Readonly<Partial<Record<Secrets, string>>>
  /** A read-only snapshot of the declared sources, taken just before the run. */
  sources: Readonly<Sources>
  /** `fetch` that refuses any host the manifest didn't list. */
  fetch: (url: string, init?: CollectorRequest) => Promise<CollectorResponse>
  /** Aborted when the run times out or the widget is removed. */
  signal: { readonly aborted: boolean }
  log: (message: string) => void
}

export type Collector<Config, Secrets extends string, Data extends JsonValue> = (
  context: CollectorContext<Config, Secrets>,
) => Promise<Data> | Data

/** Identity function that gives a collector full typing for its config, secrets and output. */
export function defineCollector<
  Config = Record<string, unknown>,
  Secrets extends string = never,
  Data extends JsonValue = JsonValue,
>(collector: Collector<Config, Secrets, Data>): Collector<Config, Secrets, Data> {
  return collector
}
