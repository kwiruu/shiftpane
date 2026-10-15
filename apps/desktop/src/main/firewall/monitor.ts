import { EventEmitter } from 'node:events'
import type { FirewallAllowResult, FirewallState } from '../../shared/firewall.ts'
import { diagnose, type Environment, type FirewallSnapshot } from './rules.ts'

export interface FirewallMonitorOptions {
  /** Absolute path of the running executable: what the firewall matches program rules against. */
  program: string
  env: Environment
  query(): Promise<FirewallSnapshot>
  /** Adds ShiftPane's rule behind a UAC prompt. */
  allow(): Promise<FirewallAllowResult>
}

/** Where phones connect: the server's port and the adapter whose address is in the QR code. */
export interface FirewallTarget {
  port: number
  interfaceAlias: string
}

/**
 * Keeps the pairing screen's firewall notice current. Checks whenever the port or the
 * advertised adapter changes, and on request (window focus, "Check again", after allowing).
 * A failed check reports "unknown" so the screen shows nothing rather than a false alarm.
 */
export class FirewallMonitor extends EventEmitter<{ change: [FirewallState] }> {
  readonly #options: FirewallMonitorOptions
  #target: FirewallTarget | null = null
  #state: FirewallState = { status: 'unknown' }
  #checking: Promise<void> | null = null
  #recheck = false
  #allowing: Promise<FirewallAllowResult> | null = null

  constructor(options: FirewallMonitorOptions) {
    super()
    this.#options = options
  }

  get state(): FirewallState {
    return this.#state
  }

  setTarget(target: FirewallTarget): void {
    if (
      this.#target?.port === target.port &&
      this.#target.interfaceAlias === target.interfaceAlias
    ) {
      return
    }
    this.#target = target
    void this.check()
  }

  /** Resolves once a check that started after this call has finished. */
  check(): Promise<void> {
    if (this.#checking) {
      this.#recheck = true
      return this.#checking
    }
    this.#checking = this.#run().finally(() => {
      this.#checking = null
    })
    return this.#checking
  }

  /** One UAC prompt at a time: a second call while one is open shares its result. */
  allow(): Promise<FirewallAllowResult> {
    this.#allowing ??= (async () => {
      const result = await this.#options.allow()
      if (result === 'allowed') await this.check()
      return result
    })().finally(() => {
      this.#allowing = null
    })
    return this.#allowing
  }

  async #run(): Promise<void> {
    do {
      this.#recheck = false
      const target = this.#target
      if (!target) return
      let state: FirewallState
      try {
        const snapshot = await this.#options.query()
        state = diagnose(
          snapshot,
          { program: this.#options.program, port: target.port },
          target.interfaceAlias,
          this.#options.env,
        )
      } catch (error) {
        console.warn('Could not check Windows Firewall:', error)
        state = { status: 'unknown' }
      }
      // A newer target or request came in meanwhile: check again before reporting.
      if (!this.#recheck) this.#setState(state)
    } while (this.#recheck)
  }

  #setState(state: FirewallState): void {
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return
    this.#state = state
    this.emit('change', state)
  }
}
