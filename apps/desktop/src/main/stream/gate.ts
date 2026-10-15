/**
 * Holds the one capture source the renderer may take next.
 *
 * The renderer asks for the screen with `getDisplayMedia`; the main process answers with
 * whatever is armed here, once. Nothing is armed unless the main process just resolved the
 * virtual monitor, so the renderer cannot capture another display, or capture at all, on its
 * own. An armed source that is not taken within `ttlMs` expires rather than waiting around for
 * a later request.
 */
export class CaptureGate<Source> {
  readonly #ttlMs: number
  readonly #now: () => number
  #armed: { source: Source; expires: number } | null = null

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? 10_000
    this.#now = options.now ?? Date.now
  }

  arm(source: Source): void {
    this.#armed = { source, expires: this.#now() + this.#ttlMs }
  }

  /** Whether a source is armed and has not expired. */
  get armed(): boolean {
    return this.#live() !== null
  }

  /** Hands the armed source over, once. */
  take(): Source | null {
    const live = this.#live()
    this.#armed = null
    return live?.source ?? null
  }

  clear(): void {
    this.#armed = null
  }

  #live(): { source: Source; expires: number } | null {
    const armed = this.#armed
    if (!armed) return null
    if (this.#now() >= armed.expires) {
      this.#armed = null
      return null
    }
    return armed
  }
}
