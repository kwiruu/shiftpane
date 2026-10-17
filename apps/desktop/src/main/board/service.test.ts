import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_BOARD, setLook } from '@shiftpane/board/model'
import type { Board, PcMessage, PhoneMessage } from '@shiftpane/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import type { PhoneInfo } from '../server/phone-hub.ts'
import { BoardService, type BoardStorage, fileStorage } from './service.ts'

const phone = (id: string): PhoneInfo => ({
  id,
  name: id,
  address: '192.168.1.4',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  connectedAt: 0,
  screen: null,
})

const dark = setLook(DEFAULT_BOARD, { radius: 0 })
const roomy = setLook(DEFAULT_BOARD, { gap: 24 })

function memory(saved: string | null = null) {
  const storage = {
    saved,
    read: async () => storage.saved,
    write: async (json: string) => {
      storage.saved = json
    },
  }
  return storage satisfies BoardStorage
}

function setup(storage: BoardStorage = memory()) {
  const events = new EventEmitter()
  const sent: Array<{ id: string; message: PcMessage }> = []
  let phones: PhoneInfo[] = []
  const service = new BoardService({
    hub: {
      on: events.on.bind(events),
      off: events.off.bind(events),
      send: (id: string, message: PcMessage) => {
        sent.push({ id, message })
        return true
      },
      get phones() {
        return phones
      },
    } as never,
    storage,
  })
  return {
    service,
    sent,
    connect: (...ids: string[]) => {
      phones = ids.map(phone)
      events.emit('change', phones)
    },
    from: (id: string, message: PhoneMessage) => events.emit('message', phone(id), message),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('BoardService', () => {
  it('tells a new phone it has no board yet, once', async () => {
    const { connect, sent } = setup()
    connect('a')
    connect('a')
    await settle()
    expect(sent).toEqual([{ id: 'a', message: { type: 'board', board: null } }])
  })

  it('sends the saved board to each phone after it connects', async () => {
    const { connect, sent, service } = setup(memory(JSON.stringify(dark)))
    expect(await service.current()).toEqual(dark)
    connect('a', 'b')
    await settle()
    expect(sent.map(({ id, message }) => [id, message])).toEqual([
      ['a', { type: 'board', board: dark }],
      ['b', { type: 'board', board: dark }],
    ])
  })

  it('ignores a saved board that does not parse', async () => {
    const { service } = setup(memory('{"tables":"no"}'))
    expect(await service.current()).toBeNull()
  })

  it('keeps a phone’s board, saves it and passes it to the other phones only', async () => {
    const storage = memory()
    const { connect, from, sent, service } = setup(storage)
    const changes: Array<Board | null> = []
    service.on('change', (board) => changes.push(board))
    connect('a', 'b')
    await settle()
    sent.length = 0
    from('a', { type: 'board.save', board: dark })
    await service.flush()
    expect(service.board).toEqual(dark)
    expect(sent).toEqual([{ id: 'b', message: { type: 'board', board: dark } }])
    expect(changes).toEqual([dark])
    expect(JSON.parse(storage.saved ?? 'null')).toEqual(dark)
  })

  it('sends the desktop editor’s board to every phone', async () => {
    const { connect, sent, service } = setup()
    connect('a', 'b')
    await settle()
    sent.length = 0
    service.set(roomy)
    expect(sent.map(({ id }) => id)).toEqual(['a', 'b'])
  })

  it('greets a phone that reconnects again', async () => {
    const { connect, sent } = setup()
    connect('a')
    connect()
    connect('a')
    await settle()
    expect(sent).toHaveLength(2)
  })
})

describe('fileStorage', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('reads nothing before the first save, then what was saved', async () => {
    dir = await mkdtemp(join(tmpdir(), 'shiftpane-board-'))
    const storage = fileStorage(join(dir, 'board.json'))
    expect(await storage.read()).toBeNull()
    await storage.write('{"a":1}')
    expect(await storage.read()).toBe('{"a":1}')
    expect(await readFile(join(dir, 'board.json'), 'utf8')).toBe('{"a":1}')
  })
})
