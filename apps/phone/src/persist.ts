import { useEffect, useState } from 'react'
import { DEMO } from './mode.ts'

// Demo mode keeps its own settings, so trying things out never changes the real ones.
const PREFIX = DEMO ? 'shiftpane.demo.' : 'shiftpane.'

/** Reads a saved value; anything missing, unreadable or blocked (private mode) gives undefined. */
export function load(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the setting just does not survive a reload.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // Blocked: there was nothing saved to remove.
  }
}

/**
 * State that survives a reload. `parse` turns whatever was saved (or undefined) into a valid
 * value, so a save from an older version can never break the page.
 */
export function usePersistentState<T>(
  key: string,
  parse: (saved: unknown) => T,
): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => parse(load(key)))
  useEffect(() => save(key, value), [key, value])
  return [value, setValue]
}
