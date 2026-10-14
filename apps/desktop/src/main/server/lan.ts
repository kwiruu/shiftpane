import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os'

export interface LanAddress {
  address: string
  /** Adapter name as the OS reports it, e.g. "Wi-Fi" or "en0". Shown when picking one. */
  interface: string
}

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./]

/** Adapters that are almost never the network the phone is on. */
const VIRTUAL_ADAPTER =
  /vethernet|virtualbox|vmware|vmnet|hyper-v|wsl|docker|br-|veth|tailscale|zerotier|utun|loopback/i

const LINK_LOCAL_V4 = /^169\.254\./

/**
 * IPv4 addresses the phone could reach, best guess first: private addresses before others
 * (some venue networks and VPNs such as Tailscale's 100.x use non-private ranges), real
 * adapters before virtual ones, and 192.168.x (home Wi-Fi) before 10.x and 172.16-31.x.
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): LanAddress[] {
  const found: (LanAddress & { rank: number })[] = []
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || LINK_LOCAL_V4.test(info.address)) continue
      const privateIndex = PRIVATE_V4.findIndex((range) => range.test(info.address))
      const rangeRank = privateIndex === 1 ? 0 : privateIndex === -1 ? 2 : 1
      const rank =
        (privateIndex === -1 ? 100 : 0) + (VIRTUAL_ADAPTER.test(name) ? 10 : 0) + rangeRank
      found.push({ address: info.address, interface: name, rank })
    }
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address))
    .map(({ address, interface: iface }) => ({ address, interface: iface }))
}
