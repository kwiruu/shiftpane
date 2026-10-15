import { HelperCallError } from '@shiftpane/helper-client'
import type { DisplayProblemReason, MonitorSize } from '../../shared/display.ts'
import { HelperUnavailableError } from './helper-host.ts'

export interface Problem {
  reason: DisplayProblemReason
  /** Phrased for the user, shown as the detail line of the notice. */
  message: string
}

const sizeLabel = (size: MonitorSize | null) => (size ? `${size.width}×${size.height}` : null)

/**
 * Turns whatever a helper call threw into something the notice can show. Helper messages are
 * already written for people (the Windows backend's `BackendUnavailable` carries the install
 * hint), so they are passed through; the app only adds a reason and, where the helper's
 * wording is a log line rather than advice, its own.
 */
export function describeProblem(error: unknown, size: MonitorSize | null): Problem {
  if (error instanceof HelperUnavailableError) {
    switch (error.reason) {
      case 'not-found':
      case 'start-failed':
        return { reason: 'helper-missing', message: error.message }
      case 'outdated':
        return { reason: 'helper-outdated', message: error.message }
      case 'no-reply':
      case 'stopped':
        return { reason: 'helper-failed', message: error.message }
    }
  }

  if (error instanceof HelperCallError) {
    const { code, message } = error.error
    switch (code) {
      case 'permissionDenied': {
        const label = sizeLabel(size)
        return {
          reason: 'permission-denied',
          message: label
            ? `Windows needs your approval to add a ${label} monitor size, and it was declined. The monitor can't be created without it.`
            : `Windows needs your approval to add monitor sizes, and it was declined. The monitor can't be created without it.`,
        }
      }
      case 'backendUnavailable':
        return { reason: 'driver-missing', message }
      case 'unsupported':
        return { reason: 'unsupported', message }
      case 'invalidParams':
        return {
          reason: 'invalid-size',
          message: `The phone asked for a monitor size the driver can't provide: ${message}`,
        }
      case 'parse':
        return {
          reason: 'helper-outdated',
          message:
            'The display helper does not understand this version of ShiftPane. Reinstall ShiftPane, or run `cargo build -p shiftpane-helper` when running from source.',
        }
      case 'internal':
        return { reason: 'failed', message }
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return { reason: 'helper-failed', message }
}
