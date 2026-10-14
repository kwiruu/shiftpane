import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { HelperCallError, HelperClient } from './client.ts'
import type { Message, Request } from './protocol.ts'

/** A scripted stand-in for the Rust helper, wired to the client through two pipes. */
function fakeHelper(answer: (request: Request) => Message | null) {
  const toHelper = new PassThrough()
  const fromHelper = new PassThrough()
  createInterface({ input: toHelper }).on('line', (line) => {
    const reply = answer(JSON.parse(line) as Request)
    if (reply) fromHelper.write(`${JSON.stringify(reply)}\n`)
  })
  return { client: new HelperClient(toHelper, fromHelper, 200), fromHelper }
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
