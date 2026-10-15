import { isIP } from 'node:net'

const MDNS_NAME = /\.local\.?$/i

/**
 * Replaces an mDNS host name in an ICE candidate with the address the phone connected from.
 *
 * Browsers hide a device's LAN address behind a random `<uuid>.local` name unless the page has
 * been given camera or microphone access, and a phone that only receives video has not. The PC
 * would have to resolve that name over multicast DNS, which the Windows firewall does not let
 * the app's process receive and which some routers drop. The phone's WebSocket already came
 * from the right address, so the candidate is rewritten to it. Candidates that carry an IP
 * address, or that cannot be read, are returned as they are.
 *
 * A candidate is `candidate:<foundation> <component> <transport> <priority> <address> <port>
 * typ <type> ...`; the address is the fifth field.
 */
export function resolveMdnsCandidate(candidate: string, phoneAddress: string): string {
  const fields = candidate.split(' ')
  const name = fields[4]
  if (fields.length < 8 || name === undefined || !MDNS_NAME.test(name)) return candidate

  const address = plainAddress(phoneAddress)
  if (address === null) return candidate
  fields[4] = address
  return fields.join(' ')
}

/** The IP address in a socket's remote address, without an IPv4-mapped prefix or zone id. */
function plainAddress(remote: string): string | null {
  const unzoned = remote.replace(/%.*$/, '')
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(unzoned)
  const address = mapped?.[1] ?? unzoned
  return isIP(address) === 0 ? null : address
}
