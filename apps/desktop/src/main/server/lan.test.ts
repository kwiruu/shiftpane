import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { lanAddresses } from './lan.ts'

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  family: 'IPv4',
  internal,
  netmask: '255.255.255.0',
  mac: '00:00:00:00:00:00',
  cidr: `${address}/24`,
})

describe('lanAddresses', () => {
  it('ranks private addresses on real adapters first', () => {
    const result = lanAddresses({
      lo: [v4('127.0.0.1', true)],
      'vEthernet (WSL)': [v4('172.24.80.1')],
      'Wi-Fi': [v4('192.168.1.20')],
      Ethernet: [v4('10.0.0.5')],
      tailscale0: [v4('100.101.1.2')],
      linkLocal: [v4('169.254.10.1')],
      v6only: [{ ...v4('fe80::1'), family: 'IPv6', scopeid: 1 }],
    })
    expect(result).toEqual([
      { address: '192.168.1.20', interface: 'Wi-Fi' },
      { address: '10.0.0.5', interface: 'Ethernet' },
      { address: '172.24.80.1', interface: 'vEthernet (WSL)' },
      { address: '100.101.1.2', interface: 'tailscale0' },
    ])
  })

  it('falls back to non-private addresses when there is nothing else', () => {
    expect(lanAddresses({ eth0: [v4('172.32.0.1')] })).toEqual([
      { address: '172.32.0.1', interface: 'eth0' },
    ])
    expect(lanAddresses({ lo: [v4('127.0.0.1', true)] })).toEqual([])
  })
})
