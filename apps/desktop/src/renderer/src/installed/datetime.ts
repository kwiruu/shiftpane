/** Native Date chooses the earlier occurrence when a local time repeats. Check every component
 * afterward to reject normalization of invalid dates and nonexistent daylight-saving times. */
export function localTarget(date: string, time: string): { value?: string; problem?: string } {
  if (!date) return {}
  const text = `${date}T${time || '00:00'}`
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text))
    return { problem: 'Choose a valid date and time.' }
  const target = new Date(text)
  if (!Number.isFinite(target.getTime()) || localDate(target) !== text) {
    return { problem: 'That local date or time does not exist. Choose another.' }
  }
  const offset = -target.getTimezoneOffset()
  const two = (value: number) => String(value).padStart(2, '0')
  const zone = `${offset < 0 ? '-' : '+'}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`
  return { value: `${text}:00${zone}` }
}

export function localDate(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}
