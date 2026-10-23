import { describe, expect, it } from 'vitest'
import { Generator, OLLAMA } from './generator.ts'

interface Call {
  url: string
  body: Record<string, unknown> | null
}

/** A pretend Ollama: its models, whether they think, and what the chat answers in turn. */
function ollama(options: {
  models?: string[]
  thinking?: boolean
  answers?: string[]
  down?: boolean
}) {
  const calls: Call[] = []
  const answers = [...(options.answers ?? [])]
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (options.down) throw new TypeError('fetch failed')
    if (!url.startsWith(OLLAMA)) throw new Error(`unexpected ${url}`)
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
    if (url.endsWith('/api/tags')) {
      return json({ models: (options.models ?? []).map((name) => ({ name })) })
    }
    if (url.endsWith('/api/show')) {
      return json({ capabilities: options.thinking ? ['completion', 'thinking'] : ['completion'] })
    }
    return json({ message: { content: answers.shift() ?? '' } })
  }) as typeof globalThis.fetch
  return { fetch: fake, calls }
}

const good = JSON.stringify({
  name: 'GPU',
  sizes: ['small', 'medium'],
  blocks: [{ show: 'gpu', as: 'ring', color: 'flame' }],
})

describe('Generator', () => {
  it('picks the best model it knows from the ones Ollama has', async () => {
    const { fetch } = ollama({ models: ['llama3.1:8b', 'qwen2.5:3b', 'qwen2.5:7b'] })
    expect(await new Generator({ fetch }).models()).toEqual({
      ok: true,
      models: ['llama3.1:8b', 'qwen2.5:3b', 'qwen2.5:7b'],
      preferred: 'qwen2.5:7b',
    })
  })

  it('says how to get Ollama when it is not running', async () => {
    const { fetch } = ollama({ down: true })
    expect(await new Generator({ fetch }).models()).toMatchObject({
      ok: false,
      problem: expect.stringContaining('ollama pull qwen3:4b'),
    })
  })

  it('turns a sentence into a recipe, held to its schema, without thinking first', async () => {
    const { fetch, calls } = ollama({ models: ['qwen3:4b'], thinking: true, answers: [good] })
    const result = await new Generator({ fetch }).generate('my GPU as a ring', 'qwen3:4b')
    expect(result).toEqual({
      ok: true,
      recipe: {
        name: 'GPU',
        sizes: ['small', 'medium'],
        blocks: [{ show: 'gpu', as: 'ring', color: 'flame' }],
      },
    })
    const chat = calls.find((call) => call.url.endsWith('/api/chat'))?.body
    expect(chat).toMatchObject({ model: 'qwen3:4b', stream: false, think: false })
    expect(chat?.format).toMatchObject({ required: ['name', 'sizes', 'blocks'] })
  })

  it('asks again once when the answer is no use, then gives up', async () => {
    const twice = ollama({ models: ['qwen2.5:3b'], answers: ['not json', good] })
    expect(await new Generator({ fetch: twice.fetch }).generate('gpu', 'qwen2.5:3b')).toMatchObject(
      { ok: true },
    )
    // A model that doesn't think isn't told not to.
    expect(twice.calls.find((call) => call.url.endsWith('/api/chat'))?.body).not.toHaveProperty(
      'think',
    )

    const never = ollama({
      models: ['qwen2.5:3b'],
      answers: ['{}', '{"blocks":[{"show":"stocks"}]}'],
    })
    expect(await new Generator({ fetch: never.fetch }).generate('gpu', 'qwen2.5:3b')).toMatchObject(
      {
        ok: false,
      },
    )
  })

  it('uses only a model Ollama has', async () => {
    const { fetch, calls } = ollama({ models: ['qwen2.5:3b'] })
    expect(await new Generator({ fetch }).generate('gpu', 'evil/model')).toMatchObject({
      ok: false,
      problem: expect.stringContaining("doesn't have evil/model"),
    })
    expect(calls.some((call) => call.url.endsWith('/api/chat'))).toBe(false)
  })
})
