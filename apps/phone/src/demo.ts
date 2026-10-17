import { type PcData, SampleFeed } from '@shiftpane/board'
import { type Board, type PhoneMessage, PROTOCOL_VERSION } from '@shiftpane/protocol'
import { useEffect, useSyncExternalStore } from 'react'
import { BoardStore, useBoardStore } from './boardStore.ts'
import type { ConnectionState } from './connection.ts'
import { load, save } from './persist.ts'
import type { StreamState } from './stream.ts'

/**
 * A pretend PC for demo mode, with the same exports as `usePcConnection.ts`: always connected,
 * fed with sample data, showing the board saved on this device or the default one. Nothing
 * leaves the page.
 */

const CONNECTED: ConnectionState = {
  status: 'connected',
  welcome: {
    type: 'welcome',
    protocol: PROTOCOL_VERSION,
    sessionId: 'demo',
    pc: { name: 'Demo PC', platform: 'windows' },
    features: { display: true, remoteControl: false },
  },
}

const IDLE_STREAM: StreamState = { phase: 'idle', stream: null, size: null, message: null }

const feed = new SampleFeed()

const board = new BoardStore({
  load: () => load('board'),
  save: (value) => save('board', value),
  send: () => true,
})

export function usePcConnection(): ConnectionState {
  useEffect(() => feed.start(), [])
  return CONNECTED
}

export function usePcStream(): StreamState {
  return IDLE_STREAM
}

export function usePcData(): PcData {
  return useSyncExternalStore(feed.store.subscribe, feed.store.getState)
}

export function useBoard(): Board {
  return useBoardStore(board)
}

export function sendToPc(message: PhoneMessage): boolean {
  if (message.type === 'media.control') feed.press(message.action)
  return true
}

export function describeConnection(_state: ConnectionState): {
  title: string
  detail: string
  tone: 'ok' | 'wait' | 'bad'
} {
  return { title: 'Demo mode', detail: 'Sample data. No PC is connected.', tone: 'ok' }
}
