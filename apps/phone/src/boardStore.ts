import { parseBoard } from '@shiftpane/board'
import type { Board, PhoneMessage } from '@shiftpane/protocol'
import { useSyncExternalStore } from 'react'

export interface BoardStoreOptions {
  /** The board saved on this phone, if any. */
  load(): unknown
  save(board: Board): void
  /** Sends to the PC; false while it is out of reach. */
  send(message: PhoneMessage): boolean
}

/**
 * The widget board this phone shows. It is laid out in the desktop app: the PC sends it after
 * connecting and whenever it changes, and the phone keeps the last one so it can show it again
 * before the PC answers. A PC that has no board yet gets this phone's.
 */
export class BoardStore {
  readonly #options: BoardStoreOptions
  readonly #listeners = new Set<() => void>()
  #board: Board

  constructor(options: BoardStoreOptions) {
    this.#options = options
    this.#board = parseBoard(options.load())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getState = (): Board => this.#board

  /** The PC's board. Null means the PC has none yet, so it gets this phone's. */
  receive(board: Board | null): void {
    if (board === null) {
      this.#options.send({ type: 'board.save', board: this.#board })
      return
    }
    if (board === this.#board) return
    this.#board = board
    this.#options.save(board)
    for (const listener of this.#listeners) listener()
  }
}

export function useBoardStore(store: BoardStore): Board {
  return useSyncExternalStore(store.subscribe, store.getState)
}
