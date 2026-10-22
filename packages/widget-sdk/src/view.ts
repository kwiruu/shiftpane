/**
 * `view.json`: how the phone draws a widget, as a tree of ShiftPane's own components, one tree per
 * size. No third-party code runs on the phone; `@shiftpane/board` renders these trees with the same
 * parts as the built-in widgets, so a widget looks the same in the app, on a phone and in the
 * gallery.
 */

import { z } from 'zod'
import { type ActionName, actionNames, type WidgetSize } from './manifest.ts'

/**
 * One node of `view.json`. `bind` is `@source/path` for a system source, `/json/pointer` for the
 * collector's output. Inside text, `{config.key}` inserts a config value and `{@source/path}` or
 * `{/pointer}` inserts a bound one, so "Playing on {@media/app}" reads the app's name.
 *
 * Sizes follow the app's own board: type and spacing scale with the card, within limits.
 */
export type ViewNode =
  | {
      type: 'stack' | 'row'
      children: ViewNode[]
      gap?: number
      align?: 'start' | 'center' | 'end' | 'between'
      /** A row only: keeps its ends in from the card's edges, like the media buttons on a wide card. */
      inset?: boolean
    }
  | { type: 'grid'; columns: number; children: ViewNode[]; gap?: number }
  | { type: 'label'; text: string }
  | {
      type: 'text'
      text?: string
      bind?: string
      size?: 'xs' | 'sm' | 'md' | 'lg'
      muted?: boolean
    }
  | {
      type: 'value'
      bind: string
      format?: ValueFormat
      unit?: string
      size?: 'sm' | 'md' | 'lg' | 'xl'
    }
  | {
      type: 'ring'
      bind: string
      label?: string
      color?: Accent
      /** `sm` is the small gauge beside a figure; the default fills the room it has. */
      size?: 'sm' | 'fill'
      /** Whether the number in the middle carries a % sign. */
      unit?: boolean
    }
  | { type: 'meter'; bind: string; segments?: number }
  | { type: 'progress'; bind: string; color?: Accent }
  | {
      type: 'history-bars'
      bind: string
      /** What a full-height bar means. Without it, the biggest value in the data. */
      max?: number
      /** Only the newest this many values. */
      count?: number
    }
  | { type: 'sparkline'; bind: string; color?: Accent }
  | { type: 'list'; bind: string; max?: number }
  | { type: 'icon'; name: string; color?: Accent }
  | { type: 'button'; action: ActionName; icon: string; label: string }
  /** A hairline across the card. */
  | { type: 'divider' }
  /** A gradient tile with an icon on it; its colors come from the bound text, so each title gets its own. */
  | { type: 'cover'; bind?: string; icon: string; size?: 'sm' | 'md' }
  /** Three small bars bouncing, for "playing". */
  | { type: 'equalizer' }
  /** A soft light behind the card's content, bleeding off a corner. */
  | { type: 'glow'; color?: Accent; corner?: 'top-right' | 'bottom-right' }

export type ValueFormat =
  | 'percent'
  | 'number'
  | 'compact'
  | 'bytes'
  | 'rate'
  | 'celsius'
  | 'duration'

/**
 * The board's loud colors, and `ink`: the card's own text color. A node without a color uses the
 * card's highlight, which is its ink too, so widgets stay black and white unless they ask.
 */
export const accents = ['flame', 'lime', 'mint', 'sky', 'ink'] as const
export type Accent = (typeof accents)[number]

export type WidgetView = Partial<Record<WidgetSize, ViewNode>>

/**
 * Icon names a view can use (`icon`, `button` and `cover` nodes). The app draws them from its own
 * icon set; a name it doesn't know draws a dot rather than failing, so this list can grow.
 */
export const widgetIcons = [
  'activity',
  'bolt',
  'coffee',
  'cpu',
  'down',
  'gauge',
  'memory',
  'music',
  'network',
  'pause',
  'play',
  'skip-back',
  'skip-forward',
  'star',
  'thermometer',
  'up',
] as const
export type WidgetIcon = (typeof widgetIcons)[number]

/** Limits on a view, so a package can't hand the phone something enormous to lay out. */
export const viewLimits = { depth: 8, nodes: 200 }

/** `@name/json/pointer` for a system source, `/json/pointer` for the collector's output. */
const Bind = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^(?:@[a-z-]+(?:\/.*)?|\/.*)$/,
    'bind a source as @name/path, or the collector output as /path',
  )
const Text = z.string().max(120)
const AccentSchema = z.enum(accents)
const IconName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use an icon name such as star')
  .max(48)

export const viewNodeSchema: z.ZodType<ViewNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('stack'),
        children: z.array(viewNodeSchema).max(24),
        gap: z.number().min(0).max(12).optional(),
        align: z.enum(['start', 'center', 'end', 'between']).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('row'),
        children: z.array(viewNodeSchema).max(24),
        gap: z.number().min(0).max(12).optional(),
        align: z.enum(['start', 'center', 'end', 'between']).optional(),
        inset: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('grid'),
        columns: z.number().int().min(1).max(6),
        children: z.array(viewNodeSchema).max(24),
        gap: z.number().min(0).max(12).optional(),
      })
      .strict(),
    z.object({ type: z.literal('label'), text: Text }).strict(),
    z
      .object({
        type: z.literal('text'),
        text: Text.optional(),
        bind: Bind.optional(),
        size: z.enum(['xs', 'sm', 'md', 'lg']).optional(),
        muted: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('value'),
        bind: Bind,
        format: z
          .enum(['percent', 'number', 'compact', 'bytes', 'rate', 'celsius', 'duration'])
          .optional(),
        unit: z.string().max(12).optional(),
        size: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('ring'),
        bind: Bind,
        label: Text.optional(),
        color: AccentSchema.optional(),
        size: z.enum(['sm', 'fill']).optional(),
        unit: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('meter'),
        bind: Bind,
        segments: z.number().int().min(1).max(40).optional(),
      })
      .strict(),
    z.object({ type: z.literal('progress'), bind: Bind, color: AccentSchema.optional() }).strict(),
    z
      .object({
        type: z.literal('history-bars'),
        bind: Bind,
        max: z.number().positive().optional(),
        count: z.number().int().min(2).max(120).optional(),
      })
      .strict(),
    z.object({ type: z.literal('sparkline'), bind: Bind, color: AccentSchema.optional() }).strict(),
    z
      .object({
        type: z.literal('list'),
        bind: Bind,
        max: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    z.object({ type: z.literal('icon'), name: IconName, color: AccentSchema.optional() }).strict(),
    z
      .object({
        type: z.literal('button'),
        action: z.enum(actionNames),
        icon: IconName,
        label: Text,
      })
      .strict(),
    z.object({ type: z.literal('divider') }).strict(),
    z
      .object({
        type: z.literal('cover'),
        bind: Bind.optional(),
        icon: IconName,
        size: z.enum(['sm', 'md']).optional(),
      })
      .strict(),
    z.object({ type: z.literal('equalizer') }).strict(),
    z
      .object({
        type: z.literal('glow'),
        color: AccentSchema.optional(),
        corner: z.enum(['top-right', 'bottom-right']).optional(),
      })
      .strict(),
  ]),
)

export const widgetViewSchema: z.ZodType<WidgetView, unknown> = z
  .object({
    small: viewNodeSchema.optional(),
    medium: viewNodeSchema.optional(),
    large: viewNodeSchema.optional(),
  })
  .strict()
  .refine((view) => Object.keys(view).length > 0, 'view.json needs a tree for at least one size')

/** `sample.json`: an example of the collector's output. Any JSON object. */
export const sampleSchema = z.record(z.string(), z.unknown())
