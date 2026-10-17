import { DEFAULT_BOARD } from '@shiftpane/board'
import type { Board } from '@shiftpane/protocol'
import { useEffect, useState } from 'react'

/**
 * The phones' widget board as the PC keeps it, and the function that changes it. Until a phone
 * or this window has made a board, the default one is shown; the first edit saves it.
 */
export function useBoard(): [Board, (board: Board) => void] {
  const [board, setBoard] = useState<Board | null>(null)

  useEffect(() => {
    let changed = false
    const off = window.shiftpane.board.onChange((next) => {
      changed = true
      setBoard(next)
    })
    void window.shiftpane.board.get().then((initial) => {
      // A change that arrived first is newer than this answer.
      if (!changed) setBoard(initial)
    })
    return off
  }, [])

  const edit = (next: Board) => {
    setBoard(next)
    void window.shiftpane.board.set(next)
  }
  return [board ?? DEFAULT_BOARD, edit]
}
