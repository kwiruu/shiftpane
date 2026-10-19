import { DEFAULT_BOARD, setLook } from '@shiftpane/board'
import type { PhoneMessage } from '@shiftpane/protocol'
import { describe, expect, it, vi } from 'vitest'
import { BoardStore } from './boardStore.ts'

const setup = (saved: unknown = undefined) => {
  const sent: PhoneMessage[] = []
  const save = vi.fn()
  const store = new BoardStore({
    load: () => saved,
    save,
    send: (message) => {
      sent.push(message)
      return true
    },
  })
  return { store, sent, save }
}

const square = setLook(DEFAULT_BOARD, { radius: 0 })

describe('BoardStore', () => {
  it('starts from the saved board, or the default', () => {
    expect(setup(square).store.getState()).toEqual(square)
    expect(setup('nonsense').store.getState()).toEqual(DEFAULT_BOARD)
  })

  it('shows and saves the PC’s board without sending it back', () => {
    const { store, sent, save } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    store.receive(square)
    expect(store.getState()).toBe(square)
    expect(save).toHaveBeenCalledWith(square)
    expect(listener).toHaveBeenCalledOnce()
    expect(sent).toEqual([])
  })

  it('gives the PC this phone’s board when the PC has none', () => {
    const { store, sent } = setup(square)
    store.receive(null)
    expect(sent).toEqual([{ type: 'board.save', board: square }])
    expect(store.getState()).toEqual(square)
  })
})
