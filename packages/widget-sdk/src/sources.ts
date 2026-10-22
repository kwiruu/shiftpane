import { z } from 'zod'
import type { ActionName, SourceName } from './manifest.ts'

/**
 * The system sources: PC data the app reads once and shares with every widget that declares it,
 * in plain words for the install prompt, the shape each one has, and the sample PC previews read.
 *
 * A widget never touches the OS itself. Its view binds `@cpu/percent`, its collector gets
 * `ctx.sources.cpu`; the app fills in only the sources the manifest lists.
 */

export interface SourceInfo {
  name: SourceName
  title: string
  gives: string
  /** What an install prompt says about it. */
  phrase: string
  /** Reveals what you're doing, so installing asks first. */
  asks: boolean
}

export const sources: Record<SourceName, SourceInfo> = {
  cpu: {
    name: 'cpu',
    title: 'CPU',
    gives: 'Load in percent, per core, and the last minute of it.',
    phrase: 'Reads your CPU load',
    asks: false,
  },
  memory: {
    name: 'memory',
    title: 'Memory',
    gives: 'Percent in use, used and total bytes, and the last minute.',
    phrase: 'Reads how much memory is in use',
    asks: false,
  },
  gpu: {
    name: 'gpu',
    title: 'GPU',
    gives: 'Load in percent, video memory used and total, and the last minute.',
    phrase: 'Reads your GPU load',
    asks: false,
  },
  network: {
    name: 'network',
    title: 'Network',
    gives: 'Bytes received and sent per second, and the last minute.',
    phrase: 'Reads your network speed',
    asks: false,
  },
  disks: {
    name: 'disks',
    title: 'Disks',
    gives: 'For each drive: space used and total, reads and writes per second.',
    phrase: "Reads your drives' space and activity",
    asks: false,
  },
  battery: {
    name: 'battery',
    title: 'Battery',
    gives: 'Percent, whether it is charging, and the time left.',
    phrase: 'Reads your battery level',
    asks: false,
  },
  audio: {
    name: 'audio',
    title: 'Audio',
    gives: 'Output volume, whether it is muted, and the device name.',
    phrase: 'Reads your volume and output device',
    asks: false,
  },
  system: {
    name: 'system',
    title: 'System',
    gives: 'Uptime, and the OS name and version.',
    phrase: 'Reads your uptime and OS version',
    asks: false,
  },
  temperatures: {
    name: 'temperatures',
    title: 'Temperatures',
    gives: 'CPU and GPU in °C and fan speeds, where the OS allows it.',
    phrase: 'Reads CPU and GPU temperatures',
    asks: false,
  },
  media: {
    name: 'media',
    title: 'Media',
    gives: 'What is playing: title, artist, app, and whether it is paused.',
    phrase: "Sees what's playing",
    asks: true,
  },
  processes: {
    name: 'processes',
    title: 'Processes',
    gives: 'The top programs by CPU or memory: name and percent.',
    phrase: 'Sees which programs are busiest',
    asks: true,
  },
  'active-window': {
    name: 'active-window',
    title: 'Active window',
    gives: 'The app in front and its window title.',
    phrase: "Sees which app and window you're in",
    asks: true,
  },
}

export const actions: Record<ActionName, { title: string; phrase: string }> = {
  'media.play-pause': { title: 'Play or pause', phrase: 'Plays and pauses your media' },
  'media.next': { title: 'Next track', phrase: 'Skips to the next track' },
  'media.previous': { title: 'Previous track', phrase: 'Goes back a track' },
  'audio.set-volume': { title: 'Set the volume', phrase: 'Changes your volume' },
  'audio.toggle-mute': { title: 'Mute or unmute', phrase: 'Mutes and unmutes your PC' },
}

// ---------------------------------------------------------------------------------------
// What each source holds. A reading the PC can't take is null, never a guess.
// ---------------------------------------------------------------------------------------

const Percent = z.number().min(0).max(100)
const Bytes = z.number().nonnegative()
/** Recent readings, oldest first, about one a second; a gap is null. */
const History = z.array(z.number().nullable()).max(120)
const Text = z.string().max(256)

export const sourceSchemas = {
  cpu: z.object({
    percent: Percent.nullable(),
    cores: z.array(Percent).max(256).optional(),
    history: History,
  }),
  memory: z.object({
    percent: Percent.nullable(),
    used: Bytes.nullable(),
    total: Bytes.nullable(),
    history: History,
  }),
  gpu: z.object({
    percent: Percent.nullable(),
    vramUsed: Bytes.nullable().optional(),
    vramTotal: Bytes.nullable().optional(),
    history: History,
  }),
  network: z.object({
    receivedPerSecond: Bytes.nullable(),
    sentPerSecond: Bytes.nullable(),
    /** Bytes received per second. */
    history: History,
  }),
  disks: z.object({
    drives: z
      .array(
        z.object({
          name: Text,
          used: Bytes,
          total: Bytes,
          percent: Percent,
          readPerSecond: Bytes.nullable().optional(),
          writePerSecond: Bytes.nullable().optional(),
        }),
      )
      .max(32),
  }),
  /** All null on a PC without a battery. */
  battery: z.object({
    percent: Percent.nullable(),
    charging: z.boolean().nullable(),
    minutesLeft: z.number().nonnegative().nullable(),
  }),
  audio: z.object({
    volume: Percent.nullable(),
    muted: z.boolean().nullable(),
    device: Text.nullable(),
  }),
  system: z.object({ uptimeSeconds: z.number().nonnegative(), os: Text }),
  temperatures: z.object({
    cpu: z.number().nullable(),
    gpu: z.number().nullable(),
    fans: z.array(z.number().nonnegative()).max(16),
  }),
  media: z.object({
    title: Text.nullable(),
    artist: Text.nullable(),
    app: Text.nullable(),
    playing: z.boolean(),
    /** Seconds, when the player says. */
    position: z.number().nonnegative().nullable().optional(),
    duration: z.number().nonnegative().nullable().optional(),
  }),
  /** Shaped for a `list` node: the program, its memory, its CPU share; the numbers for collectors. */
  processes: z.object({
    top: z
      .array(
        z.object({
          title: Text,
          subtitle: Text.optional(),
          value: Text,
          cpuPercent: Percent.optional(),
          memoryBytes: Bytes.nullable().optional(),
        }),
      )
      .max(20),
  }),
  'active-window': z.object({ app: Text.nullable(), title: Text.nullable() }),
} satisfies Record<SourceName, z.ZodType>

export type SourceData = { [Name in SourceName]: z.infer<(typeof sourceSchemas)[Name]> }

/** A snapshot of the sources one widget declared. */
export type Sources = Partial<SourceData>

// ---------------------------------------------------------------------------------------
// The sample PC
// ---------------------------------------------------------------------------------------

/** A minute of made-up samples, one a second like the app's: a slow swell with a little noise. */
function minute(base: number, swing: number, seed: number): number[] {
  return Array.from({ length: 60 }, (_, i) => {
    const wave = Math.sin((i + seed) / 6.4) * swing
    const noise = Math.sin((i + 1) * (seed + 7.3)) * swing * 0.35
    return Math.round(Math.min(100, Math.max(1, base + wave + noise)))
  })
}

const gpuHistory = minute(58, 18, 2)
const cpuHistory = minute(34, 14, 5)
const memoryHistory = minute(61, 3, 9)

/**
 * The sample PC that previews read when a view binds `@source/...`: in the gallery, in the
 * marketplace's checks and anywhere else without a real PC behind it. Every widget sees this
 * one made-up machine, so previews agree with each other.
 */
export const sampleSources: SourceData = {
  cpu: {
    percent: cpuHistory.at(-1) ?? null,
    cores: [41, 22, 37, 18, 55, 12, 29, 44],
    history: cpuHistory,
  },
  memory: {
    percent: memoryHistory.at(-1) ?? null,
    used: 19.7 * 1024 ** 3,
    total: 32 * 1024 ** 3,
    history: memoryHistory,
  },
  gpu: {
    percent: gpuHistory.at(-1) ?? null,
    vramUsed: 6.1 * 1024 ** 3,
    vramTotal: 12 * 1024 ** 3,
    history: gpuHistory,
  },
  network: {
    receivedPerSecond: 4.2 * 1024 ** 2,
    sentPerSecond: 310 * 1024,
    history: minute(30, 22, 11),
  },
  disks: {
    drives: [
      {
        name: 'C:',
        used: 612 * 1024 ** 3,
        total: 1000 * 1024 ** 3,
        percent: 61,
        readPerSecond: 3.1 * 1024 ** 2,
        writePerSecond: 820 * 1024,
      },
    ],
  },
  battery: { percent: 82, charging: false, minutesLeft: 214 },
  audio: { volume: 45, muted: false, device: 'Speakers' },
  system: { uptimeSeconds: 3 * 86_400 + 4 * 3600, os: 'Windows 11' },
  temperatures: { cpu: 61, gpu: 67, fans: [1180, 940] },
  media: {
    title: 'Late Night Drive',
    artist: 'Neon Coast',
    app: 'Spotify',
    playing: true,
    position: 248,
    duration: 488,
  },
  processes: {
    top: [
      {
        title: 'Code',
        subtitle: '1.2 GB',
        value: '12%',
        cpuPercent: 12,
        memoryBytes: 1.2 * 1024 ** 3,
      },
      {
        title: 'chrome',
        subtitle: '2.4 GB',
        value: '9%',
        cpuPercent: 9,
        memoryBytes: 2.4 * 1024 ** 3,
      },
      {
        title: 'Discord',
        subtitle: '410 MB',
        value: '3%',
        cpuPercent: 3,
        memoryBytes: 410 * 1024 ** 2,
      },
    ],
  },
  'active-window': { app: 'Code', title: 'widget.ts — shiftpane' },
}

/** Only the sources a widget declared, from a full set. */
export function pickSources(all: Sources, declared: readonly SourceName[]): Sources {
  const picked: Record<string, unknown> = {}
  for (const name of declared) {
    if (Object.hasOwn(all, name) && all[name] !== undefined) picked[name] = all[name]
  }
  return picked as Sources
}
