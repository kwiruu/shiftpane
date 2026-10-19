import { PAIRING_CODE_DIGITS, type PairingCode, parsePairingCode } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { useEffect, useState } from 'react'

interface PairScreenProps {
  /** The connection, in words: why a code is needed, or that the PC disconnected this phone. */
  status: { title: string; detail: string }
  /** The PC is looking at the code just typed. */
  checking: boolean
  /** Still paired, only disconnected: offer to reconnect instead of asking for a code. */
  disconnected: boolean
  onCode: (code: PairingCode) => void
  onReconnect: () => void
}

/**
 * In front of everything until the phone is paired. An app on the iPhone home screen never
 * sees the QR code's link (the camera opens it in Safari, which keeps its own storage), so
 * this is how it pairs: the user types the code the desktop app shows under the QR code.
 */
export function PairScreen({
  status,
  checking,
  disconnected,
  onCode,
  onReconnect,
}: PairScreenProps) {
  const [digits, setDigits] = useState('')

  // A refused code is cleared for the next try.
  useEffect(() => {
    if (!checking) setDigits('')
  }, [checking])

  const submit = (value: string) => {
    const code = parsePairingCode(value)
    if (code && !checking) onCode(code)
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/70 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] font-sans text-ink backdrop-blur-sm">
      <div
        role="dialog"
        aria-labelledby="pair-title"
        className="hatched w-[min(22rem,100%)] rounded-[24px] border border-border bg-surface-sunken p-1.5 shadow-[0_24px_80px_rgb(0_0_0/0.6)]"
      >
        <div className="rounded-[18px] border border-border bg-surface p-5">
          <span className="raised mb-4 grid size-11 place-items-center rounded-xl text-ink-soft">
            <Icon name={disconnected ? 'unlink' : 'qr'} className="size-5" />
          </span>
          <h1 id="pair-title" className="font-medium text-lg">
            {status.title}
          </h1>
          <p className="mt-1 text-ink-muted text-sm" role="status">
            {status.detail}
          </p>

          {disconnected ? (
            <button
              type="button"
              onClick={onReconnect}
              className="lifted mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium"
            >
              <Icon name="refresh" className="size-5" />
              Reconnect
            </button>
          ) : (
            <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault()
                submit(digits)
              }}
            >
              <label htmlFor="pair-code" className="section-label mb-2 block px-0.5">
                Code
              </label>
              <input
                id="pair-code"
                value={digits}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, '').slice(0, PAIRING_CODE_DIGITS)
                  setDigits(next)
                  if (next.length === PAIRING_CODE_DIGITS) submit(next)
                }}
                disabled={checking}
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="go"
                pattern="[0-9]*"
                placeholder="000000"
                aria-describedby="pair-where"
                className="w-full select-text rounded-xl border border-border bg-surface-sunken px-4 py-3 text-center font-mono text-[28px] text-ink tabular-nums tracking-[0.3em] outline-none placeholder:text-ink-faint focus:border-border-strong disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={checking || digits.length < PAIRING_CODE_DIGITS}
                className="lifted mt-3 w-full rounded-xl px-4 py-3 font-medium transition disabled:opacity-40"
              >
                {checking ? 'Checking…' : 'Pair'}
              </button>
              <p id="pair-where" className="mt-4 px-0.5 text-ink-muted text-xs">
                On the PC, open ShiftPane. The code is under the QR code on the Devices page.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
