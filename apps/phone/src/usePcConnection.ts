import { type PcData, PcDataStore } from '@shiftpane/board'
import { type Board, parsePairingHash } from '@shiftpane/protocol'
import { useEffect, useSyncExternalStore } from 'react'
import { BoardStore, useBoardStore } from './boardStore.ts'
import {
  type ConnectionState,
  guessDeviceName,
  PcConnection,
  takePairingToken,
  websocketUrl,
} from './connection.ts'
import { load, save } from './persist.ts'
import { StreamReceiver, type StreamState } from './stream.ts'
import { checkForUpdate } from './updates.ts'

// One connection per page; created at import so the token is stripped from the URL immediately.
const connection = new PcConnection({
  url: websocketUrl(),
  token: takePairingToken(parsePairingHash),
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
  },
})

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
  if (connection.getState().status !== 'connected') {
    connected = false
    receiver.reset()
    pcData.reset()
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

export function usePcConnection(): ConnectionState {
  useEffect(() => {
    connection.start()
  }, [])
  return useSyncExternalStore(connection.subscribe, connection.getState)
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
    case 'no-token':
      return {
        title: 'Not paired',
        detail: 'Scan the QR code in the ShiftPane desktop app.',
        tone: 'bad',
      }
    case 'connecting':
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
        title: state.reason === 'disconnected' ? 'Disconnected' : 'Pairing failed',
        detail: {
          unauthorized: 'This code has expired. Scan the new QR code on your PC.',
          disconnected: 'This phone was disconnected from the PC. Scan the QR code to reconnect.',
          'protocol-mismatch':
            'The phone app and the desktop app are different versions. Update ShiftPane on the PC.',
          'bad-hello': 'The PC refused the connection. Scan the QR code again.',
        }[state.reason],
        tone: 'bad',
      }
  }
}
