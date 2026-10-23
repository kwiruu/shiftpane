export type TimeMode = 'focus' | 'timer' | 'stopwatch'
export type Phase = 'focus' | 'short' | 'long'
export interface ClockState {
  value: number
  startedAt: number | null
}
export interface TimeState {
  version: 1
  mode: TimeMode
  sound: boolean
  durations: { focus: number; short: number; long: number; timer: number }
  phase: Phase
  completed: number
  clocks: Record<TimeMode, ClockState>
}
export function initialTime(): TimeState {
  return {
    version: 1,
    mode: 'focus',
    sound: true,
    durations: { focus: 25 * 60000, short: 5 * 60000, long: 15 * 60000, timer: 5 * 60000 },
    phase: 'focus',
    completed: 0,
    clocks: {
      focus: { value: 25 * 60000, startedAt: null },
      timer: { value: 5 * 60000, startedAt: null },
      stopwatch: { value: 0, startedAt: null },
    },
  }
}
export function clockValue(state: TimeState, mode: TimeMode, now: number): number {
  const clock = state.clocks[mode]
  const elapsed = clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt)
  return mode === 'stopwatch' ? clock.value + elapsed : Math.max(0, clock.value - elapsed)
}
export function nextPhase(state: TimeState, count = true): TimeState {
  const completed = state.completed + (state.phase === 'focus' && count ? 1 : 0)
  const phase =
    state.phase === 'focus'
      ? count && completed > 0 && completed % 4 === 0
        ? 'long'
        : 'short'
      : 'focus'
  return {
    ...state,
    completed,
    phase,
    clocks: { ...state.clocks, focus: { value: state.durations[phase], startedAt: null } },
  }
}
/** Jump entire cycles when restoring a long-suspended page. */
export function reconcileTime(state: TimeState, now: number): TimeState {
  let result = state
  const timer = state.clocks.timer
  if (timer.startedAt !== null && now >= timer.startedAt + timer.value) {
    result = { ...result, clocks: { ...result.clocks, timer: { value: 0, startedAt: null } } }
  }
  let focus = result.clocks.focus
  if (focus.startedAt === null || now < focus.startedAt + focus.value) return result
  let boundary = focus.startedAt + focus.value
  result = nextPhase(result)
  const cycle = 4 * result.durations.focus + 3 * result.durations.short + result.durations.long
  const cycles = Math.floor((now - boundary) / cycle)
  if (cycles > 0) {
    boundary += cycles * cycle
    result = { ...result, completed: result.completed + cycles * 4 }
  }
  while (now >= boundary + result.clocks.focus.value) {
    boundary += result.clocks.focus.value
    result = nextPhase(result)
  }
  focus = { ...result.clocks.focus, startedAt: boundary }
  return { ...result, clocks: { ...result.clocks, focus } }
}
export function restoreTime(raw: string | null): TimeState {
  try {
    const s = JSON.parse(raw ?? '') as TimeState
    if (
      s.version !== 1 ||
      !['focus', 'timer', 'stopwatch'].includes(s.mode) ||
      typeof s.sound !== 'boolean' ||
      !['focus', 'short', 'long'].includes(s.phase) ||
      !Number.isSafeInteger(s.completed) ||
      s.completed < 0
    )
      return initialTime()
    for (const mode of ['focus', 'short', 'long', 'timer'] as const) {
      const n = s.durations[mode]
      if (
        !Number.isFinite(n) ||
        n < (mode === 'timer' ? 1000 : 60000) ||
        n > (mode === 'timer' ? 359999000 : 180 * 60000)
      )
        return initialTime()
    }
    for (const mode of ['focus', 'timer', 'stopwatch'] as const) {
      const c = s.clocks[mode]
      if (
        !Number.isFinite(c.value) ||
        c.value < 0 ||
        (c.startedAt !== null && (!Number.isFinite(c.startedAt) || c.startedAt < 0))
      )
        return initialTime()
    }
    return s
  } catch {
    return initialTime()
  }
}
export function formatTime(ms: number, stopwatch = false): string {
  const seconds = stopwatch ? Math.floor(ms / 1000) : Math.ceil(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
  return `${seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:` : ''}${time}${stopwatch ? `.${pad(Math.floor(ms / 10) % 100)}` : ''}`
}
