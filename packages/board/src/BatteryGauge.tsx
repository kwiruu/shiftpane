import { useId } from 'react'
import { batteryState } from './battery.ts'

/** Fixed purple artwork, scaled to the shorter side of either card size. */
export function BatteryGauge({ data }: { data: unknown }) {
  const { percent, charging, caption, segments } = batteryState(data)
  const glow = useId()
  const label = `${percent === null ? '—' : Math.round(percent)}%`
  return (
    <div className="relative isolate flex min-h-0 w-full flex-1 items-center justify-center">
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{ inset: '-20cqmin', background: '#111111', zIndex: -1 }}
      />
      <svg
        viewBox="0 0 400 400"
        className="h-full min-h-0 w-full"
        role="img"
        aria-label={`Laptop battery: ${label}${caption ? `, ${caption}` : ''}`}
      >
        <defs>
          <radialGradient id={glow}>
            <stop stopColor="#ad79f4" stopOpacity="0.19" />
            <stop offset="1" stopColor="#ad79f4" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="200" cy="210" rx="175" ry="115" fill={`url(#${glow})`} />
        <g fill="#fafafa" fontFamily="inherit" fontSize="54" fontWeight="500" letterSpacing="-2">
          {charging && <path fill="#b681f5" d="M135 47 116 79 132 79 130 103 151 71 135 71Z" />}
          <text x={charging ? 211 : 200} y="94" textAnchor="middle">
            {label}
          </text>
        </g>
        <rect x="73" y="151" width="254" height="120" rx="25" fill="#342a43" />
        {segments.map((fill, i) => (
          <g key={i}>
            <rect x={85 + i * 47} y="163" width="41" height="96" rx="12" fill="#241f2e" />
            {fill > 0 && (
              <svg
                x={85 + i * 47}
                y="163"
                width="41"
                height="96"
                viewBox="0 0 41 96"
                overflow="hidden"
                aria-hidden="true"
              >
                <rect
                  y={96 * (1 - fill)}
                  width="41"
                  height={96 * fill}
                  rx="12"
                  fill={fill < 1 ? '#c452ef' : '#b184f4'}
                />
              </svg>
            )}
          </g>
        ))}
        {caption && (
          <text
            x="200"
            y="361"
            textAnchor="middle"
            fill="#77747b"
            fontFamily="inherit"
            fontSize="26"
            fontWeight="500"
          >
            {caption}
          </text>
        )}
      </svg>
    </div>
  )
}
