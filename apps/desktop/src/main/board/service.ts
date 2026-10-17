import { EventEmitter } from 'node:events'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { Board, type PhoneMessage } from '@shiftpane/protocol'
import type { PhoneHub, PhoneInfo } from '../server/phone-hub.ts'

/** Where the board is kept between runs. */
export interface BoardStorage {
  /** The saved JSON, or null when nothing was saved yet. */
  read(): Promise<string | null>
  write(json: string): Promise<void>
}

export interface BoardServiceOptions {
  hub: Pick<PhoneHub, 'on' | 'off' | 'send' | 'phones'>
  storage: BoardStorage
  log?: (message: string) => void
}

/**
 * The PC's copy of the phones' widget board. It is saved in the app's data folder, sent to
 * each phone right after `welcome`, and passed on whenever a phone (`board.save`) or the
 * desktop editor changes it, so every screen shows the same tables.
 *
 * Until a phone or the editor has made one there is no board: phones are told null and send
 * the board they already have.
 */
/** Who changed the board: a phone's id, `EDITOR` for the desktop window, or undefined on load. */
export type BoardSource = string | undefined

/** The desktop window's edits, as a `BoardSource`. Never a phone id: those are UUIDs. */
export const EDITOR = 'editor'

export class BoardService extends EventEmitter<{ change: [Board | null, BoardSource] }> {
  readonly #options: BoardServiceOptions
  readonly #log: (message: string) => void
  readonly #unhook: Array<() => void> = []
  readonly #greeted = new Set<string>()
  readonly #loaded: Promise<void>
  #board: Board | null = null
  /** A board was set before the saved one finished loading; the saved one is older. */
  #changedEarly = false
  #saving: Promise<void> = Promise.resolve()

  constructor(options: BoardServiceOptions) {
    super()
    this.#options = options
    this.#log = options.log ?? (() => {})
    const { hub } = options
    const onChange = (phones: PhoneInfo[]) => this.#onPhones(phones)
    const onMessage = (phone: PhoneInfo, message: PhoneMessage) => {
      if (message.type === 'board.save') this.set(message.board, phone.id)
    }
    hub.on('change', onChange)
    hub.on('message', onMessage)
    this.#unhook.push(
      () => hub.off('change', onChange),
      () => hub.off('message', onMessage),
    )
    this.#loaded = this.#load()
  }

  get board(): Board | null {
    return this.#board
  }

  /** The board once the saved copy has been read. */
  async current(): Promise<Board | null> {
    await this.#loaded
    return this.#board
  }

  /**
   * A new board from the phone `from` or the desktop editor (`EDITOR`): kept, saved, and sent
   * to every phone but the one it came from.
   */
  set(board: Board, from?: BoardSource): void {
    this.#board = board
    this.#changedEarly = true
    for (const phone of this.#options.hub.phones) {
      if (phone.id !== from) this.#options.hub.send(phone.id, { type: 'board', board })
    }
    this.#save(board)
    this.emit('change', board, from)
  }

  /** Waits for pending saves; for shutting down and tests. */
  flush(): Promise<void> {
    return this.#saving
  }

  stop(): void {
    for (const unhook of this.#unhook.splice(0)) unhook()
  }

  /** Each phone gets the board once, right after it has been welcomed. */
  #onPhones(phones: PhoneInfo[]): void {
    const present = new Set(phones.map((phone) => phone.id))
    for (const id of this.#greeted) if (!present.has(id)) this.#greeted.delete(id)
    for (const phone of phones) {
      if (this.#greeted.has(phone.id)) continue
      this.#greeted.add(phone.id)
      void this.#loaded.then(() => {
        if (this.#greeted.has(phone.id)) {
          this.#options.hub.send(phone.id, { type: 'board', board: this.#board })
        }
      })
    }
  }

  async #load(): Promise<void> {
    try {
      const json = await this.#options.storage.read()
      if (json === null || this.#changedEarly) return
      const parsed = Board.safeParse(JSON.parse(json))
      if (!parsed.success) {
        this.#log('the saved board is not valid; starting without one')
        return
      }
      this.#board = parsed.data
      this.emit('change', this.#board, undefined)
    } catch (error) {
      this.#log(`could not read the saved board: ${error instanceof Error ? error.message : error}`)
    }
  }

  #save(board: Board): void {
    const json = JSON.stringify(board)
    // One write at a time, in order, so an older board never lands after a newer one.
    this.#saving = this.#saving
      .then(() => this.#options.storage.write(json))
      .catch((error: unknown) =>
        this.#log(`could not save the board: ${error instanceof Error ? error.message : error}`),
      )
  }
}

/** Keeps the board in a JSON file, replaced whole on each save so it is never half-written. */
export function fileStorage(path: string): BoardStorage {
  return {
    read: async () => {
      try {
        return await readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    write: async (json) => {
      const temporary = `${path}.tmp`
      await writeFile(temporary, json, 'utf8')
      await rename(temporary, path)
    },
  }
}
