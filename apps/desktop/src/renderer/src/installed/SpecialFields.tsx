import { parseLocation, type WidgetLocation } from '@shiftpane/widget-sdk'
import { useEffect, useRef, useState } from 'react'
import { localDate, localTarget } from './datetime.ts'

const FIELD =
  'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-border-strong'

export function LocationField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string | number | boolean | undefined
  onChange: (value: string | undefined) => void
}) {
  const selected = parseLocation(value)
  const [query, setQuery] = useState(selected?.label ?? '')
  const [results, setResults] = useState<WidgetLocation[]>([])
  const [status, setStatus] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    if (selected?.label === query || query.trim().length < 2) {
      setResults([])
      setStatus(query && !selected ? 'Type at least two characters, then select a city.' : '')
      return
    }
    setStatus('Searching…')
    const timer = setTimeout(() => {
      void window.shiftpane.widgets
        .searchLocations(id, query)
        .then((answer) => {
          if (current !== generation.current) return
          setResults(answer.locations)
          setStatus(
            answer.problem ??
              (answer.locations.length ? 'Select a city below.' : 'No matching cities.'),
          )
        })
        .catch(() => {
          if (current === generation.current) setStatus('Could not search. Try again.')
        })
    }, 350)
    return () => {
      ++generation.current
      clearTimeout(timer)
      void window.shiftpane.widgets.cancelLocationSearch(id)
    }
  }, [id, query, selected?.label])
  return (
    <div>
      <input
        aria-label="Search cities"
        className={FIELD}
        value={query}
        maxLength={120}
        onChange={(event) => {
          setQuery(event.target.value)
          setResults([])
          onChange(undefined)
        }}
      />
      {status && (
        <p role="status" className="mt-1 text-ink-muted text-xs">
          {status}
        </p>
      )}
      {results.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
          {results.map((city) => (
            <li key={`${city.latitude}:${city.longitude}:${city.label}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-ink-soft text-sm hover:bg-surface"
                onClick={() => {
                  onChange(JSON.stringify(city))
                  setQuery(city.label)
                  setResults([])
                  setStatus('')
                }}
              >
                {city.label}
                <span className="block text-ink-muted text-xs">{city.timezone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-ink-muted text-xs">
        City search uses Open-Meteo. Select a result to save its location.
      </p>
    </div>
  )
}

export function DatetimeField({
  value,
  onChange,
}: {
  value: string | number | boolean | undefined
  onChange: (value: string | undefined) => void
}) {
  const initial =
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? localDate(new Date(value))
      : ''
  const [date, setDate] = useState(initial.slice(0, 10))
  const [time, setTime] = useState(initial.slice(11))
  const result = localTarget(date, time)
  const update = (nextDate: string, nextTime: string) => {
    setDate(nextDate)
    setTime(nextTime)
    const next = localTarget(nextDate, nextTime)
    onChange(next.problem ? 'invalid-local-time' : next.value)
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <div>
      <div className="flex gap-2">
        <input
          aria-label="Event date"
          className={FIELD}
          type="date"
          value={date}
          onChange={(event) => update(event.target.value, time)}
        />
        <input
          aria-label="Event time (optional)"
          className={FIELD}
          type="time"
          value={time}
          onChange={(event) => update(date, event.target.value)}
        />
      </div>
      <p className="mt-1 text-ink-muted text-xs">
        {timezone} · No time means midnight at the start of the date.
      </p>
      {result.problem && (
        <p role="alert" className="mt-1 text-danger text-xs">
          {result.problem}
        </p>
      )}
      {result.value && (
        <p className="mt-1 text-ink-muted text-xs">
          Target: {new Date(result.value).toLocaleString('en-US', { timeZoneName: 'longOffset' })}
        </p>
      )}
    </div>
  )
}
