import { useEffect, useRef, useState } from 'react'
import { fluid } from './parts.tsx'
import {
  clockValue,
  formatTime,
  initialTime,
  nextPhase,
  reconcileTime,
  restoreTime,
  type TimeMode,
  type TimeState,
} from './timing.ts'
import type { ElementSize } from './useElementSize.ts'

const modes: TimeMode[] = ['focus', 'timer', 'stopwatch']
const phaseNames = { focus: 'Focus session', short: 'Short break', long: 'Long break' }

export function TimeWidget({
  id,
  preview = false,
  box,
}: {
  id?: string
  preview?: boolean
  box: ElementSize
}) {
  const wide = box.width > box.height * 1.6
  const key = id && !preview ? `shiftpane.time.v1.${id}` : null
  const [state, setState] = useState<TimeState>(() => {
    try {
      return key ? reconcileTime(restoreTime(localStorage.getItem(key)), Date.now()) : initialTime()
    } catch {
      return initialTime()
    }
  })
  const [now, setNow] = useState(Date.now)
  const [settings, setSettings] = useState(false)
  const audio = useRef<AudioContext | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const unlock = () => {
    try {
      audio.current ??= new AudioContext()
      void audio.current.resume().catch(() => {})
    } catch {
      /* Audio is optional. */
    }
  }
  useEffect(() => {
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* Keep working in memory. */
    }
  }, [key, state])
  useEffect(() => {
    if (preview) return
    const tick = () => {
      if (!modes.some((mode) => stateRef.current.clocks[mode].startedAt !== null)) return
      const time = Date.now()
      setNow(time)
      const previous = stateRef.current
      const next = reconcileTime(previous, time)
      if (next === previous) return
      stateRef.current = next
      setState(next)
      const context = audio.current
      if (next.sound && context?.state === 'running') {
        try {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.frequency.value = 660
          gain.gain.setValueAtTime(0.12, context.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6)
          oscillator.connect(gain).connect(context.destination)
          oscillator.start()
          oscillator.stop(context.currentTime + 0.6)
          oscillator.onended = () => {
            oscillator.disconnect()
            gain.disconnect()
          }
        } catch {
          /* Timing continues without audio. */
        }
      }
    }
    const interval = setInterval(tick, state.mode === 'stopwatch' ? 30 : 200)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [preview, state.mode])
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {})
    },
    [],
  )

  const update = (change: (value: TimeState) => TimeState) => {
    if (preview) return
    unlock()
    const time = Date.now()
    setNow(time)
    setState((previous) => change(reconcileTime(previous, time)))
  }
  const mode = state.mode
  const clock = state.clocks[mode]
  const running = clock.startedAt !== null
  const value = clockValue(state, mode, now)
  const duration = mode === 'focus' ? state.durations[state.phase] : state.durations.timer
  const progress = mode === 'stopwatch' ? (value % 60000) / 60000 : Math.min(1, value / duration)
  const reset = () =>
    update((s) => ({
      ...s,
      ...(mode === 'focus' ? { phase: 'focus' as const, completed: 0 } : {}),
      clocks: {
        ...s.clocks,
        [mode]: { value: mode === 'stopwatch' ? 0 : s.durations[mode], startedAt: null },
      },
    }))
  const toggle = () =>
    update((s) => {
      const c = s.clocks[mode]
      return {
        ...s,
        clocks: {
          ...s.clocks,
          [mode]:
            c.startedAt === null
              ? {
                  value:
                    mode !== 'stopwatch' && c.value === 0
                      ? s.durations[mode === 'focus' ? s.phase : 'timer']
                      : c.value,
                  startedAt: Date.now(),
                }
              : { value: clockValue(s, mode, Date.now()), startedAt: null },
        },
      }
    })
  const changeDuration = (field: keyof TimeState['durations'], amount: number) =>
    update((s) => {
      const durations = { ...s.durations, [field]: amount }
      return {
        ...s,
        durations,
        ...(field !== 'timer' ? { phase: 'focus' as const, completed: 0 } : {}),
        clocks: {
          ...s.clocks,
          [field === 'timer' ? 'timer' : 'focus']: {
            value: field === 'timer' ? amount : durations.focus,
            startedAt: null,
          },
        },
      }
    })
  const buttonClass =
    'rounded-full px-[0.8em] py-[0.4em] font-medium transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-40'
  return (
    <div
      className={`${wide ? 'grid' : 'flex flex-col'} size-full min-h-0 items-center gap-[2cqmin]`}
      style={{
        fontSize: fluid(7, 4.2, 15),
        ...(wide
          ? {
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
              gridTemplateRows: 'auto 1fr auto',
            }
          : {}),
      }}
    >
      <fieldset
        className="flex w-full shrink-0 justify-center gap-[1cqmin]"
        aria-label="Time mode"
        style={wide ? { gridColumn: 2, gridRow: 1 } : undefined}
      >
        {modes.map((item) => (
          <button
            key={item}
            type="button"
            disabled={preview}
            aria-pressed={mode === item}
            className={`${buttonClass} ${mode === item ? 'bg-card-line' : 'text-card-muted'}`}
            onClick={() => {
              setSettings(false)
              update((s) => ({ ...s, mode: item }))
            }}
          >
            {item === 'stopwatch' ? 'Stopwatch' : item === 'focus' ? 'Focus' : 'Timer'}
          </button>
        ))}
      </fieldset>
      {settings ? (
        <div
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto px-1"
          style={wide ? { gridColumn: 1, gridRow: '1 / 4' } : undefined}
        >
          <p className="font-medium">{mode === 'focus' ? 'Session lengths' : 'Timer duration'}</p>
          {mode === 'focus' &&
            (['focus', 'short', 'long'] as const).map((field) => (
              <label key={field} className="flex items-center justify-between gap-2">
                <span>{`${phaseNames[field]} (min)`}</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  step={1}
                  defaultValue={state.durations[field] / 60000}
                  className="w-[5em] rounded-lg border border-card-line bg-transparent p-1 text-right"
                  onBlur={(event) => {
                    const n = Number(event.target.value)
                    if (Number.isInteger(n) && n >= 1 && n <= 180) changeDuration(field, n * 60000)
                    else event.target.value = String(state.durations[field] / 60000)
                  }}
                />
              </label>
            ))}
          {mode === 'timer' && (
            <div className="flex gap-2">
              {[
                { label: 'Hours', unit: 3600, max: 99 },
                { label: 'Minutes', unit: 60, max: 59 },
                { label: 'Seconds', unit: 1, max: 59 },
              ].map(({ label, unit, max }) => (
                <label key={label} className="flex min-w-0 flex-1 flex-col gap-1">
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={max}
                    step={1}
                    defaultValue={
                      Math.floor(state.durations.timer / 1000 / unit) % (unit === 3600 ? 100 : 60)
                    }
                    className="w-full rounded-lg border border-card-line bg-transparent p-1"
                    onBlur={(event) => {
                      const old =
                        Math.floor(state.durations.timer / 1000 / unit) % (unit === 3600 ? 100 : 60)
                      const n = Number(event.target.value)
                      if (Number.isInteger(n) && n >= 0 && n <= max) {
                        const amount = Math.max(
                          1000,
                          state.durations.timer + (n - old) * unit * 1000,
                        )
                        changeDuration('timer', amount)
                        event.target.value = String(
                          Math.floor(amount / 1000 / unit) % (unit === 3600 ? 100 : 60),
                        )
                      } else event.target.value = String(old)
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            className={`${buttonClass} bg-card-line`}
            onClick={() => setSettings(false)}
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div
            className="relative min-h-0 w-full flex-1"
            style={wide ? { gridColumn: 1, gridRow: '1 / 4', height: '100%' } : undefined}
          >
            <svg
              className="absolute inset-0 size-full"
              viewBox="0 0 240 240"
              role="img"
              aria-label={mode === 'stopwatch' ? 'Elapsed minute progress' : 'Time remaining'}
            >
              <circle
                cx="120"
                cy="120"
                r="106"
                fill="none"
                stroke="currentColor"
                opacity="0.13"
                strokeWidth="10"
              />
              <circle
                cx="120"
                cy="120"
                r="106"
                fill="none"
                stroke="#2828ff"
                strokeWidth="10"
                strokeLinecap="round"
                pathLength="1"
                strokeDasharray={`${progress} 1`}
                transform="rotate(-90 120 120)"
              />
              <text
                x="120"
                y="119"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="currentColor"
                style={{
                  fontSize: mode === 'stopwatch' || value >= 3600000 ? 32 : 44,
                  fontWeight: 650,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-1.5px',
                }}
              >
                {formatTime(value, mode === 'stopwatch')}
              </text>
              <text
                x="120"
                y="151"
                textAnchor="middle"
                fill="currentColor"
                opacity="0.5"
                style={{ fontSize: 11 }}
              >
                {mode === 'focus'
                  ? phaseNames[state.phase]
                  : mode === 'stopwatch'
                    ? 'Elapsed time'
                    : value === 0
                      ? 'Time is up'
                      : 'Time remaining'}
              </text>
              {mode === 'focus' && (
                <text
                  x="120"
                  y="170"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.4"
                  style={{ fontSize: 10 }}
                >
                  Session{' '}
                  {state.phase === 'focus'
                    ? (state.completed % 4) + 1
                    : ((state.completed + 3) % 4) + 1}{' '}
                  of 4
                </text>
              )}
            </svg>
          </div>
          <div
            className="flex shrink-0 items-center justify-center gap-[2cqmin]"
            style={wide ? { gridColumn: 2, gridRow: 2 } : undefined}
          >
            <button
              type="button"
              disabled={preview}
              className={`${buttonClass} bg-card-line`}
              onClick={reset}
            >
              Reset
            </button>
            <button
              type="button"
              disabled={preview}
              className={`${buttonClass} text-white`}
              style={{ background: '#2828ff' }}
              onClick={toggle}
            >
              {running ? 'Pause' : 'Start'}
            </button>
            {mode === 'focus' && (
              <button
                type="button"
                disabled={preview}
                className={`${buttonClass} bg-card-line`}
                onClick={() =>
                  update((s) => {
                    const next = nextPhase(s, false)
                    return {
                      ...next,
                      clocks: {
                        ...next.clocks,
                        focus: {
                          ...next.clocks.focus,
                          startedAt: s.clocks.focus.startedAt === null ? null : Date.now(),
                        },
                      },
                    }
                  })
                }
              >
                Skip
              </button>
            )}
          </div>
        </>
      )}
      <div
        className="flex w-full shrink-0 justify-center gap-[3cqmin] whitespace-nowrap text-card-muted"
        style={wide ? { gridColumn: 2, gridRow: 3 } : undefined}
      >
        {mode !== 'stopwatch' && (
          <button
            type="button"
            disabled={running || preview}
            className="disabled:opacity-40"
            onClick={() => setSettings(!settings)}
          >
            {settings ? 'Close' : 'Duration'}
          </button>
        )}
        <button
          type="button"
          disabled={preview}
          aria-pressed={state.sound}
          onClick={() => update((s) => ({ ...s, sound: !s.sound }))}
        >
          Sound {state.sound ? 'on' : 'off'}
        </button>
      </div>
    </div>
  )
}
