import { contributionMonth, contributionWeeks } from './contributions.ts'
import { fluid } from './parts.tsx'

const COLORS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function ContributionCalendar({
  data,
  weeks = 54,
  split = false,
  monthOnly = false,
  boxesOnly = false,
}: {
  data: unknown
  weeks?: number
  split?: boolean
  monthOnly?: boolean
  boxesOnly?: boolean
}) {
  const calendar = monthOnly ? contributionMonth(data) : contributionWeeks(data, weeks)
  if (monthOnly || boxesOnly) {
    return (
      <svg
        className="min-h-0 w-full flex-1"
        viewBox={
          monthOnly
            ? `0 0 89 ${Math.max(1, calendar.length) * 13 - 2}`
            : `0 0 ${Math.max(1, calendar.length) * 13 - 2} 89`
        }
        role="group"
        aria-label="GitHub contribution activity"
      >
        {calendar.map((week, row) =>
          week.map(
            (day, column) =>
              day && (
                <rect
                  key={day.date}
                  x={(monthOnly ? column : row) * 13}
                  y={(monthOnly ? row : column) * 13}
                  width="11"
                  height="11"
                  rx="2"
                  fill={COLORS[day.level]}
                  role="img"
                  aria-label={`${day.date}: ${day.count} contributions`}
                />
              ),
          ),
        )}
      </svg>
    )
  }
  if (!calendar.length)
    return (
      <p className="text-card-muted" style={{ fontSize: fluid(11, 6, 16) }}>
        Waiting for GitHub data
      </p>
    )
  const total = calendar.flat().reduce((sum, day) => sum + (day?.count ?? 0), 0)
  const midpoint = Math.ceil(calendar.length / 2)
  const groups = split ? [calendar.slice(0, midpoint), calendar.slice(midpoint)] : [calendar]
  const columns = Math.max(...groups.map((group) => group.length))
  const labels = weeks > 8
  const top = labels ? 13 : 0
  const blockHeight = top + 7 * 13
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col justify-center gap-2">
      <svg
        className="min-h-0 w-full flex-1"
        viewBox={`0 0 ${columns * 13} ${groups.length * blockHeight + (groups.length - 1) * 8}`}
        role="group"
        aria-label={`${total} contributions in the displayed period`}
      >
        {groups.map((group, groupIndex) =>
          group.map((week, x) => {
            const first = week.find((day) => day !== null)
            const previous = group[x - 1]?.find((day) => day !== null)
            const month = first?.date.slice(0, 7)
            const showMonth =
              labels &&
              first &&
              (x === 0 || month !== previous?.date.slice(0, 7)) &&
              (x !== 0 ||
                group
                  .slice(1, 3)
                  .every((next) => next.find((day) => day !== null)?.date.slice(0, 7) === month)) &&
              x <= columns - 3
            const offset = groupIndex * (blockHeight + 8)
            return (
              <g key={`${groupIndex}-${x}`}>
                {showMonth && (
                  <text x={x * 13} y={offset + 8} fill="#9198a1" fontSize="8">
                    {MONTHS[Number(first.date.slice(5, 7)) - 1]}
                  </text>
                )}
                {week.map(
                  (day, y) =>
                    day && (
                      <rect
                        key={day.date}
                        x={x * 13}
                        y={offset + top + y * 13}
                        width="10"
                        height="10"
                        rx="2"
                        fill={COLORS[day.level]}
                        role="img"
                        aria-label={`${day.date}: ${day.count} contributions`}
                      >
                        <title>
                          {day.date}: {day.count} contributions
                        </title>
                      </rect>
                    ),
                )}
              </g>
            )
          }),
        )}
      </svg>
      <p className="shrink-0 text-card-muted" style={{ fontSize: fluid(10, 5.5, 16) }}>
        <span className="font-semibold text-card-ink">{total.toLocaleString('en-US')}</span>{' '}
        contributions
      </p>
    </div>
  )
}
