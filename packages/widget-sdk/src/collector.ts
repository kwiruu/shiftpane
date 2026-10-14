/**
 * Collectors run on the PC on a timer and return plain JSON for the widget's view.
 *
 * They receive only what their manifest declared: a `fetch` limited to
 * `permissions.network`, and the secrets listed in `permissions.secrets`. The return value
 * must be JSON-serialisable; it is sent to the phone as-is.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface CollectorContext<Config, Secrets extends string> {
  config: Readonly<Config>
  secrets: Readonly<Record<Secrets, string>>
  /** `fetch` that rejects any host not listed in the manifest. */
  fetch: typeof globalThis.fetch
  /** Aborted when the run times out or the widget is removed. */
  signal: AbortSignal
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
