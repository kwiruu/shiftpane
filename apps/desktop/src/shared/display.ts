/** Virtual-monitor status the main process pushes to the desktop window. Types only: shared by main, preload and renderer. */

export interface MonitorSize {
  width: number
  height: number
}

/** Why the virtual monitor is not working; each reason has its own wording and remedy. */
export type DisplayProblemReason =
  /** The Virtual Display Driver is not installed, or its monitor is missing. */
  | 'driver-missing'
  /** The user declined the Windows administrator prompt that adds a monitor size. */
  | 'permission-denied'
  /** This OS has no virtual display implementation yet. */
  | 'unsupported'
  /** The phone asked for a size the driver cannot provide. */
  | 'invalid-size'
  /** The helper executable was not found or could not be started. */
  | 'helper-missing'
  /** The helper does not speak this app's protocol: a stale build or a mismatched install. */
  | 'helper-outdated'
  /** The helper exited or stopped answering. */
  | 'helper-failed'
  /** The helper reported an error that has no better category. */
  | 'failed'

export type DisplayState =
  /** The helper has not been asked yet. */
  | { status: 'unknown' }
  /** The backend is ready and no phone is using the monitor. */
  | { status: 'idle' }
  /** Preparing sizes or switching the monitor; Windows may be waiting on a UAC prompt. */
  | { status: 'working'; size: MonitorSize | null }
  | { status: 'attached'; phoneId: string; size: MonitorSize }
  | {
      status: 'problem'
      reason: DisplayProblemReason
      /** Already phrased for the user; for `driver-missing` it carries the install hint. */
      message: string
      /** The size that could not be set up, when the problem is about one. */
      size: MonitorSize | null
    }

/**
 * How big things are on the phone's monitor: the size of the phone's own apps (`phone`), whatever
 * the OS picks for it (`os`), or a scale in percent.
 */
export type MonitorScale = 'phone' | 'os' | number

/** The scales offered for the phone's monitor: Windows' own steps, up to 300%. */
export const SCALE_CHOICES = [100, 125, 150, 175, 200, 225, 250, 300] as const
