import type { PcData } from '@shiftpane/board'
import type { Board, PairingCode, PhoneMessage, SplitName } from '@shiftpane/protocol'
import type { ConnectionState } from './connection.ts'
import * as demo from './demo.ts'
import { DEMO } from './mode.ts'
import type { StreamState } from './stream.ts'
import * as live from './usePcConnection.ts'

/** What the UI needs from the PC; the real connection or, in demo mode, a pretend PC. */
interface PcLink {
  usePcConnection(): ConnectionState
  /** Pairs this phone with the code the desktop app shows. */
  pairWithCode(code: PairingCode): void
  /** Connects again after the PC disconnected this phone. */
  reconnect(): void
  usePcStream(): StreamState
  usePcData(): PcData
  /** The widget board, as the PC last sent it. */
  useBoard(): Board
  sendToPc(message: PhoneMessage): boolean
  /** Calls `listener` when the desktop window picks a split for this phone; returns an unsubscribe function. */
  onPcSplit(listener: (split: SplitName) => void): () => void
  describeConnection(state: ConnectionState): {
    title: string
    detail: string
    tone: 'ok' | 'wait' | 'bad'
  }
}

const link: PcLink = DEMO ? demo : live

export const {
  usePcConnection,
  pairWithCode,
  reconnect,
  usePcStream,
  usePcData,
  useBoard,
  sendToPc,
  onPcSplit,
  describeConnection,
} = link
