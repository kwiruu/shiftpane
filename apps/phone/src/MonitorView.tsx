import { useEffect, useRef } from 'react'
import { DEMO } from './mode.ts'
import type { StreamState } from './stream.ts'

interface MonitorViewProps {
  state: StreamState
  /** The monitor size this split asks the PC for, shown until video arrives. */
  wanted: { width: number; height: number }
  /** The PC reports a working virtual display backend. */
  available: boolean
}

function describe(state: StreamState, available: boolean): string {
  if (DEMO) return "In the real app, the PC's screen appears here."
  if (state.phase === 'failed') return state.message ?? 'The monitor stream stopped.'
  if (!available) return 'The PC has no virtual display ready. Install the driver on the PC.'
  if (state.phase === 'connecting') return 'Starting the monitor…'
  return 'Waiting for the PC monitor…'
}

/**
 * The PC's virtual monitor, filling the monitor area. The video is muted and inline so phones
 * start it without a tap; until it arrives the area says what is being waited for.
 */
export function MonitorView({ state, wanted, available }: MonitorViewProps) {
  const video = useRef<HTMLVideoElement>(null)
  const { stream } = state

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = stream
    if (stream) element.play().catch(() => {})
  }, [stream])

  return (
    <div className="relative size-full bg-black">
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        disablePictureInPicture
        disableRemotePlayback
        className="size-full object-contain"
      />
      {!stream && (
        <div className="hatched absolute inset-3 grid place-items-center rounded-[24px] border border-border p-6 text-center font-sans text-ink">
          <div>
            <p className="font-light text-4xl tabular-nums tracking-tight">
              {wanted.width}
              <span className="mx-1.5 text-ink-faint">×</span>
              {wanted.height}
            </p>
            <p className="mt-3 font-mono text-ink-muted text-xs" role="status">
              {describe(state, available)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
