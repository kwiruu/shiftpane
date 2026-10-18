import { Icon } from '@shiftpane/ui/icons'
import { type ReactNode, useState } from 'react'
import type { DisplayProblemReason, DisplayState } from '../../shared/display.ts'
import { Button } from './shell/parts.tsx'

type Problem = Extract<DisplayState, { status: 'problem' }>
type Working = Extract<DisplayState, { status: 'working' }>

/**
 * Shown above the QR code while the virtual monitor is being set up or cannot be. Windows may
 * be waiting for the user's approval, so the working state says to look for the prompt.
 */
export function DisplayNotice({ state }: { state: DisplayState }) {
  if (state.status === 'working') return <Progress state={state} />
  if (state.status === 'problem') return <Trouble state={state} />
  return null
}

function Progress({ state }: { state: Working }) {
  const { size } = state
  return (
    <div
      role="status"
      className="flex w-full gap-3 rounded-[0.625rem] border border-border bg-surface/60 p-3.5 text-left text-sm"
    >
      <span className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-warn" aria-hidden />
      <div>
        <p className="font-medium">
          {size
            ? `Setting up a ${size.width}×${size.height} monitor…`
            : 'Getting monitor sizes ready…'}
        </p>
        <p className="mt-1 text-ink-muted">
          If Windows asks for permission, approve it. It only asks when a new monitor size is added.
        </p>
      </div>
    </div>
  )
}

function Trouble({ state }: { state: Problem }) {
  const [pending, setPending] = useState(false)
  const { title, retry } = describe(state.reason)

  async function tryAgain() {
    setPending(true)
    try {
      await window.shiftpane.display.retry()
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      role="alert"
      className="flex w-full gap-3 rounded-[0.625rem] border border-warn/25 bg-warn/[0.06] p-3.5 text-left text-sm"
    >
      <Icon name="warning" className="size-5 text-warn" />
      <div className="min-w-0">
        <p className="font-medium text-warn">{title}</p>
        <p className="mt-1 text-ink-muted">{withCode(state.message)}</p>
        {retry && (
          <Button icon="refresh" disabled={pending} onClick={tryAgain} className="mt-3">
            {pending ? 'Working…' : retry}
          </Button>
        )}
      </div>
    </div>
  )
}

function describe(reason: DisplayProblemReason): { title: string; retry: string | null } {
  switch (reason) {
    case 'driver-missing':
      return { title: 'Virtual Display Driver is not installed', retry: 'Check again' }
    case 'permission-denied':
      return { title: 'Windows approval was declined', retry: 'Try again' }
    case 'unsupported':
      return { title: 'Virtual monitors are not available on this PC yet', retry: null }
    case 'invalid-size':
      return { title: 'The phone asked for a monitor size that cannot be used', retry: null }
    case 'helper-missing':
      return { title: 'ShiftPane’s display helper was not found', retry: 'Check again' }
    case 'helper-outdated':
      return { title: 'ShiftPane’s display helper is out of date', retry: 'Check again' }
    case 'helper-failed':
      return { title: 'ShiftPane’s display helper stopped', retry: 'Try again' }
    case 'failed':
      return { title: 'Could not set up the virtual monitor', retry: 'Try again' }
  }
}

/** Shows `backticked` spans of a message as code, so commands in install hints stand out. */
function withCode(message: string): ReactNode[] {
  return message.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      // Odd entries are the captured spans. The parts never reorder, so the index is a stable key.
      <code
        key={index}
        className="rounded border border-border bg-surface px-1 font-mono text-xs text-ink-soft"
      >
        {part}
      </code>
    ) : (
      part
    ),
  )
}
