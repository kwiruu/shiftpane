import { useEffect, useState } from 'react'
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/widgets.ts'

/** The app's settings, and the function that changes them. */
export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  useEffect(() => {
    let changed = false
    const off = window.shiftpane.settings.onChange((next) => {
      changed = true
      setSettings(next)
    })
    void window.shiftpane.settings.get().then((first) => {
      if (!changed && first) setSettings(first)
    })
    return off
  }, [])
  const change = (patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
    void window.shiftpane.settings.set(patch)
  }
  return [settings, change]
}
