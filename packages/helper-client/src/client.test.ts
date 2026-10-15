import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { HelperCallError, HelperClient, spawnHelper } from './client.ts'
import type { Message, Request } from './protocol.ts'

/** A scripted stand-in for the Rust helper, wired to the client through two pipes. */
function fakeHelper(
  answer: (request: Request) => Message | null,
  timeouts: { timeoutMs?: number; slowTimeoutMs?: number; replyDelayMs?: number } = {},
) {
  const toHelper = new PassThrough()
  const fromHelper = new PassThrough()
  createInterface({ input: toHelper }).on('line', (line) => {
    const reply = answer(JSON.parse(line) as Request)
    if (!reply) return
    const send = () => fromHelper.write(`${JSON.stringify(reply)}\n`)
    if (timeouts.replyDelayMs) setTimeout(send, timeouts.replyDelayMs)
    else send()
  })
  return {
    client: new HelperClient(
      toHelper,
      fromHelper,
      timeouts.timeoutMs ?? 200,
      timeouts.slowTimeoutMs,
    ),
    fromHelper,
  }
}

describe('HelperClient', () => {
  it('sends typed requests and resolves typed results', async () => {
    const seen: Request[] = []
    const { client } = fakeHelper((request) => {
      seen.push(request)
      return { kind: 'result', id: request.id, result: { type: 'detached' } }
    })
    await expect(client.call('display.detach')).resolves.toEqual({ type: 'detached' })
    expect(seen).toEqual([{ id: 1, method: 'display.detach' }])
  })

  it('passes params for calls that take them', async () => {
    const { client } = fakeHelper((request) => {
      if (request.method !== 'display.attach') return null
      const { width, height, refreshHz } = request.params
      return {
        kind: 'result',
        id: request.id,
        result: {
          type: 'attached',
          display: {
            id: 'v1',
            name: 'ShiftPane',
            x: 0,
            y: 0,
            width,
            height,
            refreshHz,
            scaleFactor: 1,
            primary: false,
            virtualDisplay: true,
          },
        },
      }
    })
    const result = await client.call('display.attach', { width: 1440, height: 1080, refreshHz: 60 })
    expect(result.display.width).toBe(1440)
  })

  it('sends a size list for display.prepare and resolves how many were added', async () => {
    const seen: Request[] = []
    const { client } = fakeHelper((request) => {
      seen.push(request)
      return { kind: 'result', id: request.id, result: { type: 'prepared', added: 2 } }
    })
    const sizes = [
      { width: 1440, height: 1080 },
      { width: 1080, height: 1440 },
    ]
    await expect(client.call('display.prepare', { sizes })).resolves.toEqual({
      type: 'prepared',
      added: 2,
    })
    expect(seen).toEqual([{ id: 1, method: 'display.prepare', params: { sizes } }])
  })

  it('gives calls that can wait on a UAC prompt a longer timeout', async () => {
    const answer = (request: Request): Message => ({
      kind: 'result',
      id: request.id,
      result:
        request.method === 'display.prepare'
          ? { type: 'prepared', added: 1 }
          : { type: 'detached' },
    })
    // The reply takes 120 ms: past the 50 ms default, inside the 400 ms slow timeout.
    const { client } = fakeHelper(answer, {
      timeoutMs: 50,
      slowTimeoutMs: 400,
      replyDelayMs: 120,
    })
    await expect(
      client.call('display.prepare', { sizes: [{ width: 1440, height: 1080 }] }),
    ).resolves.toEqual({ type: 'prepared', added: 1 })
    await expect(client.call('display.detach')).rejects.toThrow(/did not answer display.detach/)
  })

  it('rejects with the helper error', async () => {
    const { client } = fakeHelper((request) => ({
      kind: 'error',
      id: request.id,
      error: { code: 'unsupported', message: 'not yet' },
    }))
    const failure = client.call('display.list')
    await expect(failure).rejects.toBeInstanceOf(HelperCallError)
    await expect(failure).rejects.toMatchObject({ error: { code: 'unsupported' } })
  })

  it('times out when the helper stays silent', async () => {
    const { client } = fakeHelper(() => null)
    await expect(client.call('helper.hello')).rejects.toThrow(/did not answer/)
  })

  it('fails pending calls when the helper exits, and refuses new ones', async () => {
    const { client, fromHelper } = fakeHelper(() => null)
    const pending = client.call('helper.hello')
    fromHelper.end()
    await expect(pending).rejects.toThrow(/exited/)
    await expect(client.call('helper.hello')).rejects.toThrow(/not running/)
  })

  it('reports a missing binary instead of throwing, and fails calls', async () => {
    const errors: Error[] = []
    const { client } = spawnHelper('/definitely/not/here/shiftpane-helper', {
      onError: (error) => errors.push(error),
      timeoutMs: 500,
    })
    // Fails because the helper is gone, well before the 500 ms timeout would have.
    await expect(client.call('helper.hello')).rejects.toThrow(/exited|not running/)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'ENOENT' })
  })

  it('emits events and reports unmatched lines without throwing', async () => {
    const { client, fromHelper } = fakeHelper(() => null)
    const events: unknown[] = []
    const errors: string[] = []
    client.on('event', (event) => events.push(event))
    client.on('protocolError', (line) => errors.push(line))
    fromHelper.write('{"kind":"event","event":{"type":"displaysChanged","displays":[]}}\n')
    fromHelper.write('garbage\n')
    fromHelper.write('{"kind":"result","id":99,"result":{"type":"detached"}}\n')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toEqual([{ type: 'displaysChanged', displays: [] }])
    expect(errors).toHaveLength(2)
  })
})
