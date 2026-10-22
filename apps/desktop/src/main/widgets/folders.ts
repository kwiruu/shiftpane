import { type FSWatcher, watch } from 'node:fs'
import type { InstalledWidgets } from './installed.ts'

export interface FolderWatcherOptions {
  installed: InstalledWidgets
  /** How long to wait after the last change before reloading, as editors save in bursts. */
  delayMs?: number
  log?: (message: string) => void
}

/**
 * In Developer mode, a widget loaded from a folder reloads when its files change, so editing it
 * shows on the phone at once. A change that asks for anything new is not applied on its own: it
 * waits for "Load again" and the permission prompt, like any install.
 */
export class FolderWatcher {
  readonly #options: FolderWatcherOptions
  readonly #watchers = new Map<string, { path: string; watcher: FSWatcher }>()
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
  #enabled = false

  constructor(options: FolderWatcherOptions) {
    this.#options = options
    options.installed.on('installed', () => this.#sync())
  }

  /** Watches the folders while Developer mode is on, and none while it is off. */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    this.#sync()
  }

  stop(): void {
    this.#enabled = false
    this.#sync()
  }

  #sync(): void {
    const wanted = new Map<string, string>()
    if (this.#enabled) {
      for (const { id, origin } of this.#options.installed.entries()) {
        if (origin.kind === 'folder') wanted.set(id, origin.path)
      }
    }
    for (const [id, { path, watcher }] of this.#watchers) {
      if (wanted.get(id) === path) continue
      watcher.close()
      this.#watchers.delete(id)
      clearTimeout(this.#timers.get(id))
    }
    for (const [id, path] of wanted) {
      if (this.#watchers.has(id)) continue
      try {
        const watcher = watch(path, () => this.#changed(id, path))
        watcher.on('error', () => watcher.close())
        this.#watchers.set(id, { path, watcher })
      } catch (error) {
        this.#options.log?.(`can't watch ${path}: ${(error as Error).message}`)
      }
    }
  }

  #changed(id: string, path: string): void {
    clearTimeout(this.#timers.get(id))
    this.#timers.set(
      id,
      setTimeout(() => void this.#reload(id, path), this.#options.delayMs ?? 300),
    )
  }

  async #reload(id: string, path: string): Promise<void> {
    const { installed, log } = this.#options
    const check = await installed.check(path)
    if (check.status !== 'ready') {
      log?.(
        `${id} not reloaded: ${check.status === 'invalid' ? check.problems.join(' ') : check.status}`,
      )
      return
    }
    if (check.widget.id !== id || (check.replaces?.added.length ?? 0) > 0) {
      log?.(`${id} not reloaded: it asks for something new, so it waits for Load again`)
      return
    }
    await installed.install(check.token)
  }
}
