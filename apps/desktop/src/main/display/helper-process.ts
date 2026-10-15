import { spawnHelper } from '@shiftpane/helper-client'
import type { OpenedHelper, OpenHooks } from './helper-host.ts'

/** The production way to start the helper: a child process speaking JSON lines on stdio. */
export function openHelperProcess(path: string, hooks: OpenHooks): OpenedHelper {
  const { client, process: child } = spawnHelper(path, {
    onLog: hooks.onLog,
    onError: hooks.onError,
  })
  const closed = new Promise<void>((resolve) => {
    client.once('close', resolve)
    child.once('exit', () => resolve())
  })
  return {
    channel: client,
    closed,
    kill: () => {
      child.kill()
    },
  }
}
