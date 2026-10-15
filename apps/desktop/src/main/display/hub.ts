import type { PcMessage, PhoneMessage } from '@shiftpane/protocol'
import type { PhoneHub, PhoneInfo } from '../server/phone-hub.ts'
import type { DisplayController } from './controller.ts'

/** The controller methods the hub drives, and the events it listens to. */
export type DisplayBinding = Pick<
  DisplayController,
  'phoneJoined' | 'phoneLeft' | 'streamRequested' | 'streamStopped' | 'on' | 'off'
>

type DisplayError = Extract<PcMessage, { type: 'error' }>

const displayError = (message: string): DisplayError => ({
  type: 'error',
  code: 'display-unavailable',
  message: message.slice(0, 1024),
})

/**
 * Connects phones to the virtual monitor: a phone that pairs gets its sizes prepared, its
 * `stream.request` / `stream.stop` move the monitor, and leaving removes it. The phone is told
 * with an `error` message when its monitor could not be provided.
 *
 * It does not send `stream.ready`: that means video is flowing, which the capture code decides.
 * Listen to the controller's `attached` event for the display to capture.
 *
 * Returns a function that unhooks everything.
 */
export function bindDisplayToHub(display: DisplayBinding, hub: PhoneHub): () => void {
  const known = new Set<string>()

  const onChange = (phones: PhoneInfo[]) => {
    const present = new Set(phones.map((phone) => phone.id))
    for (const phone of phones) {
      if (known.has(phone.id)) continue
      known.add(phone.id)
      display.phoneJoined({
        id: phone.id,
        viewport: phone.viewport,
        devicePixelRatio: phone.devicePixelRatio,
      })
    }
    for (const id of known) {
      if (present.has(id)) continue
      known.delete(id)
      display.phoneLeft(id)
    }
  }

  const onMessage = (phone: PhoneInfo, message: PhoneMessage) => {
    if (message.type === 'stream.request') display.streamRequested(phone.id, message.size)
    else if (message.type === 'stream.stop') display.streamStopped(phone.id)
  }

  const onFailed = ({ phoneId, problem }: { phoneId: string; problem: { message: string } }) => {
    hub.send(phoneId, displayError(problem.message))
  }
  const onPreempted = ({ phoneId }: { phoneId: string }) => {
    hub.send(phoneId, displayError('Another phone is using the PC monitor.'))
  }

  hub.on('change', onChange)
  hub.on('message', onMessage)
  display.on('failed', onFailed)
  display.on('preempted', onPreempted)
  return () => {
    hub.off('change', onChange)
    hub.off('message', onMessage)
    display.off('failed', onFailed)
    display.off('preempted', onPreempted)
  }
}
