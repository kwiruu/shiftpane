import type { PcStatsData } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import type { StatsSample } from './data.ts'
import { bytesParts, rateParts } from './format.ts'
import {
  Bar,
  clampPercent,
  fluid,
  Glow,
  HistoryBars,
  Label,
  Meter,
  Ring,
  Sparkline,
  Value,
  Waiting,
} from './parts.tsx'
import type { ElementSize } from './useElementSize.ts'

/** The PC's load: an overview and one widget each for CPU, memory and network. */

interface StatsProps {
  stats: PcStatsData | null
  /** Recent samples, oldest first. */
  recent: StatsSample[]
  box: ElementSize
}

const percentText = (percent: number | null) =>
  percent === null ? '—' : String(Math.round(clampPercent(percent)))

const memoryPercent = (stats: PcStatsData) =>
  stats.memory && stats.memory.totalBytes > 0
    ? (stats.memory.usedBytes / stats.memory.totalBytes) * 100
    : null

/** One labelled figure in a row of them. */
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <Value value={value} unit={unit} size={fluid(15, 9, 26)} className="mt-[1.5cqmin]" />
    </div>
  )
}

/** A ring with the percentage in it, as big as the card allows. */
function SmallGauge({ percent, label, box }: { percent: number; label: string; box: ElementSize }) {
  const size = Math.min(box.width, box.height)
  return (
    <div className="grid h-full place-items-center">
      <Ring percent={percent} size={`${size}px`} thickness={10}>
        <p className="font-semibold tabular-nums" style={{ fontSize: Math.max(13, size * 0.24) }}>
          {percentText(percent)}
          <span className="text-[0.55em]">%</span>
        </p>
        <p className="mt-0.5 text-card-muted" style={{ fontSize: Math.max(9, size * 0.11) }}>
          {label}
        </p>
      </Ring>
    </div>
  )
}

export function PcStatsWidget({ stats, recent, box }: StatsProps) {
  if (!stats) return <Waiting />
  const memory = memoryPercent(stats)
  const down = stats.network ? rateParts(stats.network.receivedPerSecond) : null
  const up = stats.network ? rateParts(stats.network.sentPerSecond) : null

  if (box.height < 130 || box.width < 220) {
    return (
      <div className="grid h-full grid-cols-2 items-center gap-3">
        <Stat label="CPU" value={percentText(stats.cpuPercent)} unit="%" />
        <Stat label="RAM" value={percentText(memory)} unit="%" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>CPU load</Label>
          <Value
            value={percentText(stats.cpuPercent)}
            unit="%"
            size={fluid(34, 26, 80)}
            className="mt-[2cqmin]"
          />
        </div>
        <Ring percent={memory ?? 0} size={fluid(54, 30, 96)} thickness={7} color="var(--card-ink)">
          <p className="font-semibold tabular-nums" style={{ fontSize: fluid(13, 7.5, 22) }}>
            {percentText(memory)}
          </p>
          <p className="mt-0.5 text-card-muted" style={{ fontSize: fluid(9, 4.5, 12) }}>
            RAM
          </p>
        </Ring>
      </div>
      {box.height >= 240 ? (
        <div className="my-[5cqmin] min-h-0 flex-1 border-card-line border-b pb-[5cqmin]">
          <HistoryBars values={recent.slice(-48).map((s) => s.cpu)} />
        </div>
      ) : (
        <div className="border-card-line border-t" />
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="GPU"
          value={percentText(stats.gpuPercent)}
          unit={stats.gpuPercent === null ? undefined : '%'}
        />
        <Stat label="Download" value={down?.value ?? '—'} unit={down?.unit} />
        <Stat label="Upload" value={up?.value ?? '—'} unit={up?.unit} />
      </div>
    </div>
  )
}

export function CpuWidget({ stats, recent, box }: StatsProps) {
  if (!stats) return <Waiting />
  const cpu = stats.cpuPercent
  if (cpu === null) return <Waiting label="No CPU reading" />

  if (Math.min(box.width, box.height) < 120)
    return <SmallGauge percent={cpu} label="CPU" box={box} />

  const wide = box.width > box.height * 1.4
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center text-flame">
          <Icon name="bolt" className="size-[clamp(18px,13cqmin,40px)]" />
          <Value
            value={percentText(cpu)}
            unit="%"
            size={fluid(30, 22, 72)}
            className="text-card-ink"
          />
        </div>
        {wide && stats.gpuPercent !== null && <Label>GPU {percentText(stats.gpuPercent)}%</Label>}
      </div>
      <div className="mt-[6cqmin] flex min-h-0 flex-1 items-center">
        {wide ? (
          <HistoryBars values={recent.slice(-40).map((s) => s.cpu)} />
        ) : (
          // Blocks a little taller than wide, however tall the card is.
          <div className="w-full" style={{ height: 'min(100%, 36cqw)' }}>
            <Meter percent={cpu} />
          </div>
        )}
      </div>
      <Label className="mt-[5cqmin] text-center">
        {wide ? 'CPU load · last 40 s' : 'CPU load'}
      </Label>
    </div>
  )
}

export function MemoryWidget({ stats, box }: StatsProps) {
  if (!stats) return <Waiting />
  if (!stats.memory) return <Waiting label="No memory reading" />
  const { usedBytes, totalBytes } = stats.memory
  const percent = clampPercent(totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0)
  const used = bytesParts(usedBytes)
  const total = bytesParts(totalBytes)
  const free = bytesParts(Math.max(0, totalBytes - usedBytes))

  if (box.width < 120) return <SmallGauge percent={percent} label="RAM" box={box} />

  const roomy = box.height >= 150 && box.width >= 200
  return (
    <div className="flex h-full flex-col justify-between">
      <Label>Memory</Label>
      <div className="flex items-baseline gap-1">
        <Value value={used.value} unit={used.unit} size={fluid(22, 17, 52)} />
        <span
          className="whitespace-nowrap font-medium text-card-muted"
          style={{ fontSize: fluid(13, 8, 24) }}
        >
          / {total.value} {total.unit}
        </span>
      </div>
      <Bar
        percent={percent}
        color="var(--color-flame)"
        height={fluid(12, roomy ? 11 : 9, 36)}
        radius={fluid(6, 3.5, 12)}
      />
      {roomy && (
        <div className="flex gap-4" style={{ fontSize: fluid(11, 5.8, 14) }}>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-flame" />
            Used {Math.round(percent)}%
          </span>
          <span className="flex items-center gap-1.5 text-card-muted">
            <span className="size-2 rounded-full bg-card-line" />
            Free {free.value} {free.unit}
          </span>
        </div>
      )}
    </div>
  )
}

export function NetworkWidget({ stats, recent, box }: StatsProps) {
  if (!stats) return <Waiting />
  if (!stats.network) return <Waiting label="No network reading" />
  const down = rateParts(stats.network.receivedPerSecond)
  const up = rateParts(stats.network.sentPerSecond)

  if (box.height < 120) {
    return (
      <div className="flex h-full flex-col justify-center gap-[3cqmin]">
        {[
          { icon: 'down' as const, parts: down, color: 'text-flame' },
          { icon: 'up' as const, parts: up, color: 'text-sky' },
        ].map(({ icon, parts, color }) => (
          <div key={icon} className="flex items-center gap-1.5">
            <Icon name={icon} className={`size-[clamp(14px,9cqmin,22px)] ${color}`} />
            <Value value={parts.value} unit={parts.unit} size={fluid(16, 15, 30)} />
          </div>
        ))}
      </div>
    )
  }

  const wide = box.width >= 260
  return (
    <div className="relative flex h-full flex-col">
      <Glow style={{ right: '-25%', bottom: '-40%' }} />
      <div className="relative flex items-start justify-between gap-2">
        <div>
          <Label>Download</Label>
          <div className="mt-[2cqmin] flex items-center gap-1">
            <Icon name="down" className="size-[clamp(16px,10cqmin,32px)] text-flame" />
            <Value value={down.value} unit={down.unit} size={fluid(26, 19, 60)} />
          </div>
        </div>
        {wide && (
          <div className="text-right">
            <Label>Upload</Label>
            <div className="mt-[2cqmin] flex items-center justify-end gap-1">
              <Icon name="up" className="size-[clamp(14px,8cqmin,26px)] text-sky" />
              <Value value={up.value} unit={up.unit} size={fluid(18, 12, 36)} />
            </div>
          </div>
        )}
      </div>
      <div className="relative mt-[5cqmin] min-h-0 flex-1">
        <Sparkline
          series={[
            { values: recent.map((s) => s.down), color: 'var(--color-flame)' },
            { values: recent.map((s) => s.up), color: 'var(--color-sky)' },
          ]}
        />
      </div>
      {!wide && (
        <Label className="relative mt-[3cqmin]">
          ↑ {up.value} {up.unit}
        </Label>
      )}
    </div>
  )
}
