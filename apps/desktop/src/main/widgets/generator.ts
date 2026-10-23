import { accents, widgetSizes } from '@shiftpane/widget-sdk'
import {
  MAX_BLOCKS,
  metricIds,
  metrics,
  repairRecipe,
  shows,
  showsFor,
  showTitles,
} from '../../shared/studio.ts'
import type { GeneratorModels, GeneratorResult } from '../../shared/widgets.ts'

/**
 * Widget Studio's generator: a sentence in, a recipe out, from an open-weights model running on
 * this PC in Ollama. Nothing leaves the PC, and nothing the model writes runs: its answer is held
 * to a JSON schema of the recipe, checked again by `repairRecipe`, and drawn by the app's own
 * components like any other widget.
 */

/** Ollama's own address. The generator talks to nothing else. */
export const OLLAMA = 'http://127.0.0.1:11434'

/** Open-weights models that write good recipes, best first; any other installed model works too. */
export const PREFERRED_MODELS = [
  'qwen3:4b',
  'qwen3:8b',
  'qwen2.5:7b',
  'qwen2.5:3b',
  'llama3.2:3b',
  'phi4-mini:latest',
]

/** A model runs on the CPU on most PCs, so an answer can take a while. */
const TIMEOUT_MS = 180_000
export const MAX_PROMPT = 400

/** The recipe's shape, for Ollama to hold the model's answer to. */
const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 48 },
    description: { type: 'string', maxLength: 200 },
    sizes: {
      type: 'array',
      items: { type: 'string', enum: widgetSizes },
      minItems: 1,
      maxItems: widgetSizes.length,
    },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_BLOCKS,
      items: {
        type: 'object',
        properties: {
          show: { type: 'string', enum: metricIds },
          as: { type: 'string', enum: shows },
          label: { type: 'string', maxLength: 24 },
          color: { type: 'string', enum: accents },
        },
        required: ['show', 'as'],
      },
    },
  },
  required: ['name', 'sizes', 'blocks'],
}

const SYSTEM = `You design small widgets for a phone that shows live data from a PC. Answer with one JSON object, nothing else.

A widget has a short "name", a one-sentence "description", the "sizes" it comes in (small is one square cell, medium is two cells wide, large is two by two), and 1 to ${MAX_BLOCKS} "blocks". The first block is the biggest. Each block shows one PC reading ("show") one way ("as"), with an optional short "label" and an optional "color" (flame is orange, lime is yellow-green, mint is green, sky is blue, ink is plain).

Readings, and the ways each can be shown:
${metricIds.map((id) => `- ${id}: ${metrics[id].title} (${showsFor(id).join(', ')})`).join('\n')}

Ways to show a reading: ${shows.map((show) => `${show} = ${showTitles[show].toLowerCase()}`).join('; ')}.

Use only the readings the request asks for. Prefer a ring or bars for a percent, a value for speeds and temperatures. Choose small and medium unless the request needs more room.

Example request: GPU load as a ring with the last minute
Example answer: {"name":"GPU","description":"GPU load as a ring, with the last minute beside it.","sizes":["small","medium"],"blocks":[{"show":"gpu","as":"ring","color":"flame"}]}

Example request: my download and upload speed, and the CPU
Example answer: {"name":"Network and CPU","description":"Download and upload speed, with the CPU load.","sizes":["medium"],"blocks":[{"show":"download","as":"bars","color":"sky"},{"show":"upload","as":"value"},{"show":"cpu","as":"bar"}]}`

interface Tags {
  models?: { name: string }[]
}

export interface GeneratorOptions {
  fetch?: typeof fetch
  log?: (message: string) => void
}

export class Generator {
  readonly #fetch: typeof fetch
  readonly #log: (message: string) => void
  #running: AbortController | null = null

  constructor(options: GeneratorOptions = {}) {
    this.#fetch = options.fetch ?? fetch
    this.#log = options.log ?? (() => {})
  }

  /** The models Ollama has, and the one to use when the user hasn't picked: the best we know. */
  async models(): Promise<GeneratorModels> {
    try {
      const response = await this.#fetch(`${OLLAMA}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) return { ok: false, problem: `Ollama answered ${response.status}.` }
      const names = ((await response.json()) as Tags).models?.map((model) => model.name) ?? []
      if (names.length === 0) {
        return {
          ok: false,
          problem: 'Ollama has no models yet. Add one with: ollama pull qwen3:4b',
        }
      }
      const preferred = PREFERRED_MODELS.find((name) => names.includes(name)) ?? names[0] ?? null
      return { ok: true, models: names, preferred }
    } catch {
      return {
        ok: false,
        problem:
          "Ollama isn't running on this PC. Install it from ollama.com, then: ollama pull qwen3:4b",
      }
    }
  }

  /** Asks `model` for a recipe; one at a time, and `cancel` stops it. */
  async generate(prompt: string, model: string): Promise<GeneratorResult> {
    const request = prompt.trim().slice(0, MAX_PROMPT)
    if (!request) return { ok: false, problem: 'Say what the widget should show.' }
    const listed = await this.models()
    if (!listed.ok) return listed
    if (!listed.models.includes(model)) {
      return { ok: false, problem: `Ollama doesn't have ${model}. Pick another model.` }
    }

    this.cancel()
    const controller = new AbortController()
    this.#running = controller
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const started = Date.now()
    try {
      const thinks = await this.#thinks(model, controller.signal)
      // Small models sometimes miss; the second try says so.
      for (const attempt of [1, 2]) {
        const answer = await this.#ask(model, request, attempt, thinks, controller.signal)
        const recipe = answer === null ? null : repairRecipe(parseJson(answer))
        if (recipe) {
          this.#log(`generated with ${model} in ${Math.round((Date.now() - started) / 1000)} s`)
          return { ok: true, recipe }
        }
        this.#log(`${model} answered something unusable (try ${attempt})`)
      }
      return {
        ok: false,
        problem: `${model} didn't make a widget from that. Try saying it another way.`,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          ok: false,
          problem: Date.now() - started >= TIMEOUT_MS ? `${model} took too long.` : 'Stopped.',
        }
      }
      return { ok: false, problem: `Ollama: ${(error as Error).message}` }
    } finally {
      clearTimeout(timer)
      if (this.#running === controller) this.#running = null
    }
  }

  cancel(): void {
    this.#running?.abort()
    this.#running = null
  }

  /** Whether a model thinks out loud first, which only slows a recipe down. */
  async #thinks(model: string, signal: AbortSignal): Promise<boolean> {
    try {
      const response = await this.#fetch(`${OLLAMA}/api/show`, {
        method: 'POST',
        body: JSON.stringify({ model }),
        signal,
      })
      if (!response.ok) return false
      const { capabilities } = (await response.json()) as { capabilities?: string[] }
      return capabilities?.includes('thinking') ?? false
    } catch {
      if (signal.aborted) throw new Error('stopped')
      return false
    }
  }

  async #ask(
    model: string,
    request: string,
    attempt: number,
    thinks: boolean,
    signal: AbortSignal,
  ): Promise<string | null> {
    const retry =
      attempt > 1
        ? ' (Your last answer was not a usable widget. Use only the readings and ways listed.)'
        : ''
    const response = await this.#fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: RECIPE_SCHEMA,
        ...(thinks ? { think: false } : {}),
        options: { temperature: attempt > 1 ? 0.5 : 0.2 },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Request: ${request}${retry}` },
        ],
      }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `answered ${response.status}`)
    }
    const body = (await response.json()) as { message?: { content?: string } }
    return body.message?.content ?? null
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
