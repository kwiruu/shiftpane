import {
  type Accent,
  type ActionName,
  type BindingContext,
  formatValue,
  interpolate,
  resolveBinding,
  type ViewNode,
  viewFor,
  type WidgetSize,
  type WidgetView,
} from '@shiftpane/widget-sdk'
import type { CSSProperties } from 'react'
import { ContributionCalendar } from './ContributionCalendar.tsx'
import {
  Bar,
  Cover,
  clampPercent,
  Equalizer,
  fluid,
  Glow,
  HistoryBars,
  Label,
  Meter,
  Ring,
  Sparkline,
  Value,
  WidgetIcon,
} from './parts.tsx'
import type { ElementSize } from './useElementSize.ts'

/*
 * A widget drawn from its view.json: a tree of the same parts the built-in widgets use, so a
 * widget from the marketplace or a folder looks like one ShiftPane ships, on the phone, in the
 * desktop window and in the gallery. Nothing a widget's author wrote runs here; their tree only
 * picks and arranges these parts and says where each one's data comes from.
 *
 * Type, rings, covers and buttons are sized with `fluid` like the built-in widgets. The pieces
 * that set a layout's proportions (gaps, meters, lists, icons) are a share of `--u`, one board
 * cell: the card's shorter side for small and medium trees, half of it for large ones, so a tree
 * laid out for one size keeps its proportions on any card.
 */

/** The content box from which a card is drawn as a large tree, when it isn't wide. */
const LARGE_FROM = 260

/**
 * The tree to draw for a card of this size: medium on a wide card, large on a big one, small
 * otherwise. A widget without that tree gets its nearest one (`viewFor`).
 */
export function sizeForBox(box: ElementSize): WidgetSize {
  if (box.width >= box.height * 1.5) return 'medium'
  return Math.min(box.width, box.height) >= LARGE_FROM ? 'large' : 'small'
}

const u = (share: number) => `calc(var(--u) * ${share})`

const ACCENTS: Record<Accent, string> = {
  flame: 'var(--color-flame)',
  lime: 'var(--color-lime)',
  mint: 'var(--color-mint)',
  sky: 'var(--color-sky)',
  ink: 'var(--card-ink)',
}

/** A node without a color uses the card's highlight. */
const accent = (color: Accent | undefined) => (color ? ACCENTS[color] : 'var(--card-accent)')

const TEXT_SIZES = {
  xs: fluid(11, 5.5, 14),
  sm: fluid(12, 6.5, 17),
  md: fluid(14, 8.5, 24),
  lg: fluid(20, 13, 38),
}

/** The figure sizes the built-in widgets use: a stat, memory, CPU and the PC overview's CPU. */
const VALUE_SIZES = {
  sm: fluid(15, 9, 26),
  md: fluid(22, 17, 52),
  lg: fluid(30, 22, 72),
  xl: fluid(34, 26, 80),
}

const ALIGN = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const

const percentOf = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? clampPercent(value) : 0

const numbers = (value: unknown): (number | null)[] =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    : []

/** Nodes that take the room left over in a row; the rest keep their own size. */
const GROWS = new Set<ViewNode['type']>([
  'stack',
  'grid',
  'list',
  'history-bars',
  'sparkline',
  'text',
  'progress',
  'meter',
  'contribution-calendar',
])

interface Draw {
  context: BindingContext
  /** The buttons this widget may press. */
  actions: ReadonlySet<ActionName>
  connected: boolean
  onAction?: (action: ActionName) => void
}

export interface ViewWidgetProps {
  view: WidgetView
  /** Which tree to draw. */
  size: WidgetSize
  context: BindingContext
  /** The buttons this widget may press: the actions its manifest declares. */
  actions?: readonly ActionName[]
  /** False while the phone cannot reach the PC: the buttons do nothing then. */
  connected?: boolean
  onAction?: (action: ActionName) => void
}

/**
 * Draws a widget's tree for `size` filling its box, which has to sit inside a widget card (a
 * size container with the card's padding inside it, as `WidgetCard` makes).
 */
export function ViewWidget({
  view,
  size,
  context,
  actions = [],
  connected = true,
  onAction,
}: ViewWidgetProps) {
  const node = viewFor(view, size)
  if (!node) return null
  const draw: Draw = { context, actions: new Set(actions), connected, onAction }
  return (
    <div
      className="relative isolate flex size-full flex-col"
      style={{ '--u': size === 'large' ? '50cqmin' : '100cqmin' } as CSSProperties}
    >
      <Node node={node} draw={draw} fill />
    </div>
  )
}

function Node({ node, draw, fill = false }: { node: ViewNode; draw: Draw; fill?: boolean }) {
  const { context } = draw
  switch (node.type) {
    case 'stack':
    case 'row':
      return (
        <div
          // The root is positioned so a glow can bleed off its corner.
          className={`flex min-w-0 ${node.type === 'stack' ? 'flex-col' : 'flex-row items-center'} ${
            ALIGN[node.align ?? 'start']
          } ${fill ? 'relative min-h-0 flex-1' : ''}`}
          style={{
            gap: u(0.03 * (node.gap ?? 2)),
            ...(node.type === 'row' && node.inset ? { paddingInline: fluid(4, 8, 48) } : {}),
          }}
        >
          {node.children.map((child, index) => (
            <Child key={index} node={child} draw={draw} inRow={node.type === 'row'} />
          ))}
        </div>
      )
    case 'grid':
      return (
        <div
          className={`grid min-w-0 items-center ${fill ? 'min-h-0 flex-1' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${node.columns}, minmax(0, 1fr))`,
            gap: u(0.03 * (node.gap ?? 2)),
          }}
        >
          {node.children.map((child, index) => (
            <Child key={index} node={child} draw={draw} />
          ))}
        </div>
      )
    case 'label':
      return <Label>{interpolate(node.text, context)}</Label>
    case 'text': {
      const raw = node.bind ? resolveBinding(node.bind, context) : node.text
      const text =
        typeof raw === 'string' ? interpolate(raw, context) : raw == null ? '—' : String(raw)
      return (
        <p
          className={`truncate leading-tight ${node.muted ? 'text-card-muted' : 'font-semibold'}`}
          style={{ fontSize: TEXT_SIZES[node.size ?? 'md'] }}
        >
          {text}
        </p>
      )
    }
    case 'value': {
      const { value, unit } = formatValue(
        resolveBinding(node.bind, context),
        node.format,
        node.unit,
      )
      return <Value value={value} unit={unit} size={VALUE_SIZES[node.size ?? 'md']} />
    }
    case 'ring':
      return (
        <Gauge
          percent={percentOf(resolveBinding(node.bind, context))}
          label={node.label ? interpolate(node.label, context) : undefined}
          color={accent(node.color)}
          small={node.size === 'sm'}
          unit={node.unit ?? true}
        />
      )
    case 'meter':
      return (
        <div className="w-full shrink-0" style={{ height: u(0.12) }}>
          <Meter
            percent={percentOf(resolveBinding(node.bind, context))}
            segments={node.segments}
            fill="across"
            radius={u(0.035)}
          />
        </div>
      )
    case 'progress':
      return (
        <Bar
          percent={percentOf(resolveBinding(node.bind, context))}
          color={accent(node.color)}
          height={u(0.07)}
          radius={u(0.035)}
        />
      )
    case 'history-bars': {
      const values = numbers(resolveBinding(node.bind, context))
      const shown = node.count ? values.slice(-node.count) : values
      const top =
        node.max ?? Math.max(1, ...shown.filter((value): value is number => value !== null))
      return (
        <div className="flex w-full flex-1" style={{ minHeight: u(0.2) }}>
          <HistoryBars values={shown} max={top} />
        </div>
      )
    }
    case 'sparkline':
      return (
        <div className="w-full flex-1" style={{ minHeight: u(0.3) }}>
          <Sparkline
            series={[
              { values: numbers(resolveBinding(node.bind, context)), color: accent(node.color) },
            ]}
          />
        </div>
      )
    case 'contribution-calendar':
      return (
        <ContributionCalendar
          data={resolveBinding(node.bind, context)}
          weeks={node.weeks}
          split={node.split}
          monthOnly={node.monthOnly}
          boxesOnly={node.boxesOnly}
        />
      )
    case 'list':
      return <List items={resolveBinding(node.bind, context)} max={node.max} />
    case 'icon':
      return (
        <WidgetIcon
          name={node.name}
          style={{
            width: u(0.17),
            height: u(0.17),
            color: node.color ? ACCENTS[node.color] : undefined,
          }}
        />
      )
    case 'button': {
      const allowed = draw.actions.has(node.action) && draw.onAction !== undefined
      const primary = node.action === 'media.play-pause'
      const size = primary ? fluid(40, 24, 64) : fluid(34, 18, 52)
      return (
        <button
          type="button"
          aria-label={interpolate(node.label, context)}
          disabled={!draw.connected || !allowed}
          onClick={() => draw.onAction?.(node.action)}
          className={`grid shrink-0 place-items-center rounded-full transition active:scale-90 disabled:opacity-30 ${
            primary ? 'bg-card-ink text-card' : 'text-card-ink'
          }`}
          style={{ width: size, height: size }}
        >
          <WidgetIcon name={node.icon} className={primary ? 'size-[46%]' : 'size-[62%]'} />
        </button>
      )
    }
    case 'divider':
      return <div className="w-full shrink-0 border-card-line border-t" />
    case 'cover': {
      const title = node.bind ? resolveBinding(node.bind, context) : undefined
      return (
        <Cover
          title={typeof title === 'string' ? title : ''}
          icon={node.icon}
          size={node.size === 'sm' ? fluid(44, 24, 96) : fluid(44, 30, 120)}
        />
      )
    }
    case 'equalizer':
      return (
        <span className="inline-flex shrink-0" style={{ fontSize: TEXT_SIZES.xs }}>
          <Equalizer />
        </span>
      )
    case 'glow':
      return (
        <Glow
          color={node.color ? ACCENTS[node.color] : undefined}
          style={
            node.corner === 'bottom-right'
              ? { right: '-25%', bottom: '-40%', zIndex: -1 }
              : { right: '-20%', top: '-45%', zIndex: -1 }
          }
        />
      )
  }
}

function Child({ node, draw, inRow = false }: { node: ViewNode; draw: Draw; inRow?: boolean }) {
  // In a row, flexible nodes share the room; fixed ones (rings, values, icons, buttons) keep their size.
  if (inRow && GROWS.has(node.type)) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center self-stretch">
        <Node node={node} draw={draw} fill />
      </div>
    )
  }
  return (
    <Node
      node={node}
      draw={draw}
      fill={node.type === 'history-bars' || node.type === 'sparkline'}
    />
  )
}

/**
 * A ring with the figure in it: small beside a figure, like the RAM ring on the PC overview, or
 * as big as the room it has, like the CPU gauge on a small card.
 */
function Gauge({
  percent,
  label,
  color,
  small,
  unit,
}: {
  percent: number
  label?: string
  color: string
  small: boolean
  unit: boolean
}) {
  return (
    <div
      className="aspect-square shrink-0 self-center"
      style={{ width: small ? fluid(54, 30, 96) : `min(100%, ${u(0.66)})` }}
    >
      <Ring percent={percent} size="100%" thickness={small ? 7 : 10} color={color}>
        <p
          className="font-semibold tabular-nums"
          style={{ fontSize: small ? fluid(13, 7.5, 22) : u(0.16) }}
        >
          {Math.round(percent)}
          {unit && <span className="text-[0.55em]">%</span>}
        </p>
        {label && (
          <p
            className={`text-card-muted ${small ? 'mt-0.5' : 'mt-[0.2em]'}`}
            style={{ fontSize: small ? fluid(9, 4.5, 12) : u(0.08) }}
          >
            {label}
          </p>
        )}
      </Ring>
    </div>
  )
}

/** Rows of title, subtitle and value, such as repositories and their stars. */
function List({ items, max = 3 }: { items: unknown; max?: number }) {
  const rows = (Array.isArray(items) ? items : []).slice(0, max).map((item) => {
    const row = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const text = (value: unknown) =>
      typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    return { title: text(row.title), subtitle: text(row.subtitle), value: text(row.value) }
  })
  return (
    <div className="flex w-full min-w-0 flex-col justify-center" style={{ gap: u(0.025) }}>
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex min-w-0 items-baseline justify-between border-card-line not-first:border-t"
          style={{ gap: u(0.04), paddingTop: i ? u(0.025) : 0 }}
        >
          <div className="min-w-0">
            <p className="truncate font-medium" style={{ fontSize: u(0.092), lineHeight: 1.2 }}>
              {row.title}
            </p>
            {row.subtitle && (
              <p
                className="truncate text-card-muted"
                style={{ fontSize: u(0.072), lineHeight: 1.2 }}
              >
                {row.subtitle}
              </p>
            )}
          </div>
          <p className="shrink-0 tabular-nums" style={{ fontSize: u(0.092) }}>
            {row.value}
          </p>
        </div>
      ))}
    </div>
  )
}
