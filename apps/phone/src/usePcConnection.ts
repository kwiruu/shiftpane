import { type PcData, PcDataStore } from '@shiftpane/board'
import {
  type Board,
  type MonitorSource,
  type PairingCode,
  type PhoneAuth,
  parsePairingHash,
  SavedPairing,
  type SplitName,
} from '@shiftpane/protocol'
import { useEffect, useSyncExternalStore } from 'react'
import { BoardStore, useBoardStore } from './boardStore.ts'
import {
  type ConnectionState,
  guessDeviceName,
  PcConnection,
  takePairingToken,
  websocketUrl,
} from './connection.ts'
import { load, remove, save } from './persist.ts'
import { StreamReceiver, type StreamState } from './stream.ts'
import { checkForUpdate } from './updates.ts'
import { keepScreenOn } from './wakeLock.ts'

// The key from an earlier pairing goes first: a phone that is already paired and scans the QR
// code again stays the same phone on the PC. The token is only used when that key is refused.
const saved = SavedPairing.safeParse(load('pairing'))
const token = takePairingToken(parsePairingHash)
const auth: PhoneAuth[] = [
  ...(saved.success ? [{ kind: 'key' as const, ...saved.data }] : []),
  ...(token ? [{ kind: 'token' as const, token }] : []),
]

// One connection per page; created at import so the token is stripped from the URL immediately.
const connection = new PcConnection({
  url: websocketUrl(),
  auth,
  onPaired: (pairing) => save('pairing', pairing),
  onForgotten: () => remove('pairing'),
  device: () => ({
    name: guessDeviceName(navigator.userAgent),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    touch: navigator.maxTouchPoints > 0,
  }),
  onMessage: (message) => {
    receiver.handle(message)
    pcData.handle(message)
    if (message.type === 'board') board.receive(message.board)
    if (message.type === 'split.set') for (const listener of splitListeners) listener(message.split)
    if (message.type === 'source.set') {
      for (const listener of sourceListeners) listener(message.source)
    }
  },
})

// Who wants to hear that the desktop window picked a split for this phone.
const splitListeners = new Set<(split: SplitName) => void>()

// And what its monitor area shows.
const sourceListeners = new Set<(source: MonitorSource) => void>()

// The widget board the PC lays out, kept on the phone to show before the PC answers.
const board = new BoardStore({
  load: () => load('board'),
  save: (value) => save('board', value),
  send: (message) => connection.send(message),
})

// Widget data and the PC's monitor list, which arrive on the same socket as the video signaling.
const pcData = new PcDataStore()

// The PC's video for this connection. The PC forgets the phone when the socket drops and offers
// again once the phone has reconnected and asked for its monitor, so a drop just starts over.
const receiver = new StreamReceiver({
  send: (message) => connection.send(message),
  createPeerConnection: (configuration) => new RTCPeerConnection(configuration),
  log: (message) => console.info(`[stream] ${message}`),
})
// Once the PC has welcomed this phone, warm the browser's WebRTC stack up. Its first connection
// blocks the page for a moment, so it waits until the first stream request has gone out and the
// PC is busy preparing its offer; the answer is then not also waiting on that start-up.
let warmedUp = false
let connected = false
connection.subscribe(() => {
  const state = connection.getState()
  keepScreenOn(state.status === 'connected')
  if (state.status !== 'connected') {
    connected = false
    receiver.reset()
    pcData.reset()
    // The PC was updated; so is the phone app it serves, once the new copy is fetched.
    if (state.status === 'rejected' && state.reason === 'protocol-mismatch') checkForUpdate()
    return
  }
  // Just (re)connected: the PC may have restarted with a newer phone app.
  if (!connected) checkForUpdate()
  connected = true
  if (!warmedUp) {
    warmedUp = true
    setTimeout(() => receiver.warmUp(), 350)
  }
})

// A phone suspends a page it is not showing (and a home screen app whenever it locks), which
// kills the socket. Coming back, reconnect at once rather than when the backoff says.
const resume = () => {
  if (document.visibilityState === 'visible') connection.resume()
}
document.addEventListener('visibilitychange', resume)
window.addEventListener('pageshow', resume)
window.addEventListener('online', resume)

export function usePcConnection(): ConnectionState {
  useEffect(() => {
    connection.start()
  }, [])
  return useSyncExternalStore(connection.subscribe, connection.getState)
}

/** Pairs this phone with the code the desktop app shows. */
export function pairWithCode(code: PairingCode): void {
  connection.pair(code)
}

/** Connects again after the PC disconnected this phone. */
export function reconnect(): void {
  connection.reconnect()
}

/** The PC's monitor video, as far as it has got. */
export function usePcStream(): StreamState {
  return useSyncExternalStore(receiver.subscribe, receiver.getState)
}

/** Widget data and the PC's monitors, as last reported. */
export function usePcData(): PcData {
  return useSyncExternalStore(pcData.subscribe, pcData.getState)
}

/** The widget board, as the PC last sent it. */
export function useBoard(): Board {
  return useBoardStore(board)
}

/** Calls `listener` when the desktop window picks what the monitor area shows; returns an unsubscribe function. */
export function onPcSource(listener: (source: MonitorSource) => void): () => void {
  sourceListeners.add(listener)
  return () => {
    sourceListeners.delete(listener)
  }
}

/** Calls `listener` when the desktop window picks a split for this phone; returns an unsubscribe function. */
export function onPcSplit(listener: (split: SplitName) => void): () => void {
  splitListeners.add(listener)
  return () => {
    splitListeners.delete(listener)
  }
}

/** Sends one message to the PC; false when the socket is not connected right now. */
export function sendToPc(message: Parameters<PcConnection['send']>[0]): boolean {
  return connection.send(message)
}

export function describeConnection(state: ConnectionState): {
  title: string
  detail: string
  tone: 'ok' | 'wait' | 'bad'
} {
  switch (state.status) {
    case 'unpaired':
      return {
        title: 'Not paired',
        detail: {
          none: 'Type the code shown in ShiftPane on your PC.',
          'old-link': 'That QR code is out of date. Type the code shown under the new one.',
          'wrong-code': "That code didn't work. Check it on your PC and try again.",
          'code-locked': 'Too many wrong codes. Press New code on your PC, then type that one.',
          forgotten: 'Your PC forgot this phone. Type the code on your PC to pair it again.',
        }[state.problem ?? 'none'],
        tone: 'bad',
      }
    case 'connecting':
      if (state.checkingCode) {
        return { title: 'Checking the code…', detail: 'Talking to your PC.', tone: 'wait' }
      }
      return {
        title: state.attempt === 0 ? 'Connecting…' : 'Reconnecting…',
        detail:
          state.attempt === 0
            ? 'Talking to your PC.'
            : 'Lost the PC. Check that both are on the same Wi-Fi.',
        tone: 'wait',
      }
    case 'connected':
      return {
        title: `Connected to ${state.welcome.pc.name}`,
        detail: 'Choose a split and what to show below.',
        tone: 'ok',
      }
    case 'rejected':
      return {
        title: state.reason === 'disconnected' ? 'Disconnected' : "Can't connect",
        detail: {
          disconnected: 'This phone was disconnected from the PC. It is still paired.',
          'protocol-mismatch':
            'The phone app and the desktop app are different versions. Update ShiftPane on the PC.',
          'bad-hello': 'The PC refused the connection. Reload this page and try again.',
        }[state.reason],
        tone: 'bad',
      }
  }
}
