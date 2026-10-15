import { describe, expect, it } from 'vitest'
import { resolveMdnsCandidate } from './candidate.ts'

const mdns =
  'candidate:842163049 1 udp 1677729535 3f2c1a6e-96b4-4e0a-b6a3-0b5f6b8f2c11.local 54321 typ host generation 0 ufrag Ab12 network-cost 999'

describe('resolveMdnsCandidate', () => {
  it('replaces the mDNS name with the address the phone connected from', () => {
    expect(resolveMdnsCandidate(mdns, '192.168.1.42')).toBe(
      'candidate:842163049 1 udp 1677729535 192.168.1.42 54321 typ host generation 0 ufrag Ab12 network-cost 999',
    )
  })

  it('unwraps an IPv4-mapped IPv6 socket address', () => {
    expect(resolveMdnsCandidate(mdns, '::ffff:192.168.1.42')).toContain(' 192.168.1.42 54321 ')
  })

  it('uses an IPv6 address as it is, without its zone', () => {
    expect(resolveMdnsCandidate(mdns, 'fe80::1ff:fe23:4567:890a%12')).toContain(
      ' fe80::1ff:fe23:4567:890a 54321 ',
    )
  })

  it('leaves a candidate that already has an IP address alone', () => {
    const direct = 'candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0'
    expect(resolveMdnsCandidate(direct, '192.168.1.42')).toBe(direct)
  })

  it('leaves the end-of-candidates marker and junk alone', () => {
    expect(resolveMdnsCandidate('', '192.168.1.42')).toBe('')
    expect(resolveMdnsCandidate('candidate:oops', '192.168.1.42')).toBe('candidate:oops')
  })

  it('leaves the candidate alone when the phone address is not an IP address', () => {
    expect(resolveMdnsCandidate(mdns, 'not-an-address')).toBe(mdns)
    expect(resolveMdnsCandidate(mdns, '')).toBe(mdns)
  })

  it('only touches names that end in .local', () => {
    const host = mdns.replace('3f2c1a6e-96b4-4e0a-b6a3-0b5f6b8f2c11.local', 'phone.example.com')
    expect(resolveMdnsCandidate(host, '192.168.1.42')).toBe(host)
  })
})
