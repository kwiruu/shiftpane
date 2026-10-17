import type { PcData } from '@shiftpane/board'
import type { Board, PhoneMessage } from '@shiftpane/protocol'
import type { ConnectionState } from './connection.ts'
import * as demo from './demo.ts'
import { DEMO } from './mode.ts'
import type { StreamState } from './stream.ts'
import * as live from './usePcConnection.ts'

/** What the UI needs from the PC; the real connection or, in demo mode, a pretend PC. */
interface PcLink {
  usePcConnection(): ConnectionState
  usePcStream(): StreamState
  usePcData(): PcData
  /** The widget board, as the PC last sent it. */
  useBoard(): Board
  sendToPc(message: PhoneMessage): boolean
  describeConnection(state: ConnectionState): {
    title: string
    detail: string
    tone: 'ok' | 'wait' | 'bad'
  }
}

const link: PcLink = DEMO ? demo : live

export const { usePcConnection, usePcStream, usePcData, useBoard, sendToPc, describeConnection } =
  link
