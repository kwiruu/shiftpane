import { parsePairingHash } from '@shiftpane/protocol'
import { useEffect, useSyncExternalStore } from 'react'
import {
  type ConnectionState,
  guessDeviceName,
  PcConnection,
  takePairingToken,
  websocketUrl,
} from './connection.ts'

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
})

export function usePcConnection(): ConnectionState {
  useEffect(() => {
    connection.start()
  }, [])
  return useSyncExternalStore(connection.subscribe, connection.getState)
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
        detail: 'Pick a split below.',
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
