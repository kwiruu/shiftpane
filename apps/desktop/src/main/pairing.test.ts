import {
  CloseCode,
  generatePairingToken,
  type PairingCode,
  type PcMessage,
  type PhoneAuth,
  PROTOCOL_VERSION,
  type SavedPairing,
} from '@shiftpane/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_LIFETIME_MS,
  MAX_CODE_TRIES,
  PairingService,
  type PairingServiceOptions,
} from './pairing.ts'
import type { TextStorage } from './storage.ts'

function memory(): TextStorage {
  let saved: string | null = null
  return {
    read: async () => saved,
    write: async (text) => {
      saved = text
    },
  }
}

const token = generatePairingToken()

// The service is never started here: phones go straight to its hub, so no server, network or
// certificate is involved.
function makeService(options: Partial<PairingServiceOptions> = {}) {
  let code = 100_000
  return new PairingService({
    dataDir: '',
    staticRoot: '',
    platform: 'windows',
    storage: memory(),
    makeToken: () => token,
    // 100001, 100002, ...: each new code is the next number.
    makeCode: () => String(++code) as PairingCode,
    ...options,
  })
}

/** Connects a phone straight to the service's hub and says hello with `auth`. */
function connect(service: PairingService, auth: PhoneAuth) {
  const sent: PcMessage[] = []
  const closes: number[] = []
  service.hub
    .accept({
      remoteAddress: '192.168.1.42',
      send: (frame) => sent.push(JSON.parse(frame) as PcMessage),
      close: (code) => closes.push(code),
    })
    .onMessage(
      JSON.stringify({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        auth,
        device: {
          name: 'iPhone',
          viewport: { width: 390, height: 844 },
          devicePixelRatio: 3,
          touch: true,
        },
      }),
    )
  const welcome = sent.find((message) => message.type === 'welcome')
  return { welcome, closes }
}

const pairingFrom = (welcome: PcMessage | undefined): SavedPairing => {
  if (welcome?.type !== 'welcome' || !welcome.pairing) throw new Error('no pairing in welcome')
  return welcome.pairing
}

const code = (digits: number): PhoneAuth => ({ kind: 'code', code: String(digits) as PairingCode })

describe('PairingService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pairs with the QR token, then lets the phone back in with its key', async () => {
    const service = makeService()
    const pairing = pairingFrom(connect(service, { kind: 'token', token }).welcome)
    const back = connect(service, { kind: 'key', ...pairing })
    expect(back.closes).toEqual([])
    // Already paired: no new key to save.
    expect(back.welcome).not.toHaveProperty('pairing')
    expect(service.hub.phones.map((phone) => phone.deviceId)).toEqual([
      pairing.deviceId,
      pairing.deviceId,
    ])
    await service.stop()
  })

  it('refuses a wrong token and a key it never gave out', async () => {
    const service = makeService()
    const stranger = connect(service, { kind: 'token', token: generatePairingToken() })
    expect(stranger.closes).toEqual([CloseCode.unauthorized])
    const forged = connect(service, {
      kind: 'key',
      deviceId: crypto.randomUUID(),
      key: generatePairingToken() as unknown as SavedPairing['key'],
    })
    expect(forged.closes).toEqual([CloseCode.unauthorized])
    await service.stop()
  })

  it('pairs one phone per code', async () => {
    const service = makeService()
    const pairing = pairingFrom(connect(service, code(100_001)).welcome)
    expect(pairing.key).toBeTruthy()
    // That code is used up; the next phone needs the next one.
    expect(connect(service, code(100_001)).closes).toEqual([CloseCode.unauthorized])
    expect(connect(service, code(100_002)).closes).toEqual([])
    await service.stop()
  })

  it('stops taking codes after too many wrong ones, until a new code', async () => {
    const service = makeService()
    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      expect(connect(service, code(999_999)).closes).toEqual([CloseCode.unauthorized])
    }
    // Even the right code is refused now.
    expect(connect(service, code(100_001)).closes).toEqual([CloseCode.codeLocked])
    await service.newCode()
    expect(connect(service, code(100_002)).closes).toEqual([])
    await service.stop()
  })

  it('refuses a code once it has run out', async () => {
    let now = 0
    const service = makeService({ now: () => now })
    now = CODE_LIFETIME_MS
    expect(connect(service, code(100_001)).closes).toEqual([CloseCode.unauthorized])
    await service.stop()
  })

  it('forgets a phone: closes it and refuses its key', async () => {
    const service = makeService()
    const pairing = pairingFrom(connect(service, { kind: 'token', token }).welcome)
    const again = connect(service, { kind: 'key', ...pairing })
    expect(again.closes).toEqual([])
    service.forget(pairing.deviceId)
    expect(again.closes).toEqual([CloseCode.unauthorized])
    expect(connect(service, { kind: 'key', ...pairing }).closes).toEqual([CloseCode.unauthorized])
    await service.stop()
  })

  it('keeps paired phones connected when the codes are replaced, and drops the old token', async () => {
    const tokens = [token, generatePairingToken()]
    const service = makeService({ makeToken: () => tokens.shift() ?? generatePairingToken() })
    const { closes } = connect(service, { kind: 'token', token })
    await service.newCode()
    expect(closes).toEqual([])
    expect(connect(service, { kind: 'token', token }).closes).toEqual([CloseCode.unauthorized])
    await service.stop()
  })
})
