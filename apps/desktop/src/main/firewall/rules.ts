import { win32 } from 'node:path'
import { z } from 'zod'
import type { FirewallState, NetworkCategory } from '../../shared/firewall.ts'

/**
 * Decides whether Windows Firewall lets phones reach the pairing server, from rules read out
 * of the registry. Windows keeps each rule there as one string such as
 * `v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Private|LPort=47820|App=C:\x.exe|Name=x|`,
 * readable without admin and, unlike `netsh` output, not translated. (Get-NetFirewallPortFilter,
 * the other way to see ports, is access-denied for non-admin users.)
 */

/** Windows applies the firewall profile that matches the network's category. */
export type FirewallProfile = NetworkCategory

export interface FirewallRule {
  action: 'allow' | 'block' | 'other'
  enabled: boolean
  inbound: boolean
  /** IP protocol number (6 is TCP); null for any. */
  protocol: number | null
  /** null for every profile. */
  profiles: FirewallProfile[] | null
  /** Port tokens as stored: "443", "5000-5020" or keywords such as "RPC"; null for any port. */
  localPorts: string[] | null
  /** Program path as stored, possibly with %VARIABLES%; null for any program. */
  program: string | null
  /**
   * Scoped by something this module does not evaluate (a service, an app package, users,
   * addresses, interfaces, IPsec). Such a rule is never assumed to match: an allow rule that
   * might not apply does not count as allowing, and a block rule that might not apply does not
   * count as blocking.
   */
  conditional: boolean
}

export interface ProfileSettings {
  enabled: boolean
  /** Inbound connections that no rule matches are allowed (rare; the default is block). */
  defaultInboundAllow: boolean
  /** False when "Block all incoming connections, including those in the list of allowed apps" is on. */
  allowInboundRules: boolean
  /** False when Group Policy ignores rules made on this PC. */
  allowLocalRules: boolean
}

export interface NetworkProfile {
  /** What Windows calls the network, usually the Wi-Fi name. */
  name: string
  /** Adapter name; Node's `os.networkInterfaces()` uses the same one on Windows. */
  interfaceAlias: string
  category: NetworkCategory
}

export interface FirewallSnapshot {
  /** Rules made on this PC: by installers, apps, Windows' own "allow access" prompt or the user. */
  localRules: FirewallRule[]
  /** Rules pushed by Group Policy. */
  policyRules: FirewallRule[]
  profiles: Record<FirewallProfile, ProfileSettings>
  networks: NetworkProfile[]
}

/** The pairing server as the firewall sees it. */
export interface ServerIdentity {
  /** Absolute path of the running executable. */
  program: string
  /** The port actually bound, which is not always the default. */
  port: number
}

export type Environment = Record<string, string | undefined>

const TCP = 6

/** Rule fields that narrow what the rule applies to in ways not evaluated here. */
const CONDITION_KEYS = new Set([
  'Svc',
  'PFN',
  'LUAuth',
  'RMAuth',
  'RUAuth',
  'Security',
  'IF',
  'IFType',
])
const CONDITION_PREFIXES = ['LA4', 'LA6', 'RPort']

/** Parses one registry rule string. Returns null for strings that are not rules. */
export function parseRule(raw: string): FirewallRule | null {
  const [version, ...fields] = raw.split('|')
  if (!version?.startsWith('v2.')) return null

  const rule: FirewallRule = {
    action: 'other',
    enabled: false,
    inbound: false,
    protocol: null,
    profiles: null,
    localPorts: null,
    program: null,
    conditional: false,
  }
  const remoteAddresses: string[] = []
  for (const field of fields) {
    const eq = field.indexOf('=')
    if (eq <= 0) continue
    const key = field.slice(0, eq)
    const value = field.slice(eq + 1)
    if (key === 'Action') {
      rule.action = value === 'Allow' ? 'allow' : value === 'Block' ? 'block' : 'other'
    } else if (key === 'Active') {
      rule.enabled = value.toUpperCase() === 'TRUE'
    } else if (key === 'Dir') {
      rule.inbound = value === 'In'
    } else if (key === 'Protocol') {
      rule.protocol = Number.parseInt(value, 10)
    } else if (key === 'Profile') {
      const profile = value.toLowerCase()
      if (profile === 'domain' || profile === 'private' || profile === 'public') {
        rule.profiles = [...(rule.profiles ?? []), profile]
      }
    } else if (key.startsWith('LPort')) {
      // LPort=443, and newer formats as LPort2_10=5000-5020 or LPort2_20=Ply2Disc.
      rule.localPorts = [...(rule.localPorts ?? []), ...value.split(',')]
    } else if (key === 'App') {
      rule.program = value
    } else if (key.startsWith('RA4') || key.startsWith('RA6')) {
      remoteAddresses.push(value)
    } else if (CONDITION_KEYS.has(key) || CONDITION_PREFIXES.some((p) => key.startsWith(p))) {
      rule.conditional = true
    }
  }
  // Phones are on the local subnet, so "LocalSubnet" (or any address) covers them; a list of
  // specific addresses might not.
  if (
    remoteAddresses.length > 0 &&
    !remoteAddresses.some((a) => a === 'LocalSubnet' || a === '*')
  ) {
    rule.conditional = true
  }
  return rule
}

/** Whether `rule` applies to inbound TCP connections to `server` on a network with `profile`. */
export function ruleMatches(
  rule: FirewallRule,
  server: ServerIdentity,
  profile: FirewallProfile,
  env: Environment,
): boolean {
  return (
    rule.enabled &&
    rule.inbound &&
    !rule.conditional &&
    (rule.protocol === null || rule.protocol === TCP) &&
    (rule.profiles === null || rule.profiles.includes(profile)) &&
    portMatches(rule.localPorts, server.port) &&
    (rule.program === null || samePath(expandEnv(rule.program, env), server.program))
  )
}

function portMatches(tokens: string[] | null, port: number): boolean {
  if (tokens === null) return true
  return tokens.some((token) => {
    const range = /^(\d+)-(\d+)$/.exec(token.trim())
    if (range) return Number(range[1]) <= port && port <= Number(range[2])
    return /^\d+$/.test(token.trim()) && Number(token) === port
  })
}

/** Expands `%NAME%` the way Windows does, ignoring case; unknown names stay as they are. */
export function expandEnv(path: string, env: Environment): string {
  const byName = new Map(Object.entries(env).map(([name, value]) => [name.toLowerCase(), value]))
  return path.replace(
    /%([^%]+)%/g,
    (match, name: string) => byName.get(name.toLowerCase()) ?? match,
  )
}

/** Windows paths compare without case; Windows' own prompt stores them lowercased. */
function samePath(a: string, b: string): boolean {
  return win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()
}

export type FirewallVerdict =
  | { open: true }
  | { open: false; reason: 'no-rule' | 'block-rule' | 'all-inbound-blocked' | 'managed' }

/** Whether a phone on a network with `profile` can reach `server`. */
export function evaluate(
  snapshot: FirewallSnapshot,
  server: ServerIdentity,
  profile: FirewallProfile,
  env: Environment,
): FirewallVerdict {
  const settings = snapshot.profiles[profile]
  if (!settings.enabled) return { open: true }
  if (!settings.allowInboundRules) return { open: false, reason: 'all-inbound-blocked' }

  const matches = (rule: FirewallRule) => ruleMatches(rule, server, profile, env)
  const policy = snapshot.policyRules.filter(matches)
  const local = settings.allowLocalRules ? snapshot.localRules.filter(matches) : []
  // Block rules win over allow rules. A policy block cannot be removed from this PC.
  if (policy.some((rule) => rule.action === 'block')) return { open: false, reason: 'managed' }
  if (local.some((rule) => rule.action === 'block')) return { open: false, reason: 'block-rule' }
  if ([...policy, ...local].some((rule) => rule.action === 'allow')) return { open: true }
  if (settings.defaultInboundAllow) return { open: true }
  return { open: false, reason: settings.allowLocalRules ? 'no-rule' : 'managed' }
}

/**
 * What the pairing screen should say about the firewall for phones reaching `server` through
 * the adapter named `interfaceAlias` (the one whose address is in the QR code).
 */
export function diagnose(
  snapshot: FirewallSnapshot,
  server: ServerIdentity,
  interfaceAlias: string,
  env: Environment,
): FirewallState {
  const network = snapshot.networks.find((n) => n.interfaceAlias === interfaceAlias) ?? null
  // Windows treats a network it has no profile for as Public.
  const profile = network?.category ?? 'public'
  const verdict = evaluate(snapshot, server, profile, env)
  if (verdict.open) return { status: 'ok' }

  const blocked = {
    status: 'blocked',
    port: server.port,
    network: network && { name: network.name, category: network.category },
  } as const
  if (verdict.reason === 'all-inbound-blocked' || verdict.reason === 'managed') {
    return { ...blocked, reason: verdict.reason, canAllow: false }
  }
  if (profile === 'public') {
    // ShiftPane only ever allows itself on private (and domain) networks, so the way out is
    // making this network Private; say whether a rule is also missing there.
    const asPrivate = evaluate(snapshot, server, 'private', env)
    const fixable =
      !asPrivate.open && (asPrivate.reason === 'no-rule' || asPrivate.reason === 'block-rule')
    return { ...blocked, reason: 'public-network', canAllow: fixable }
  }
  return { ...blocked, reason: verdict.reason, canAllow: true }
}

/** Output of the query script in `powershell.ts`. Enum values arrive as their names. */
const SnapshotJson = z.object({
  local: z.array(z.string()),
  policy: z.array(z.string()),
  profiles: z.array(
    z.object({
      name: z.enum(['Domain', 'Private', 'Public']),
      enabled: z.string(),
      defaultInboundAction: z.string(),
      allowInboundRules: z.string(),
      allowLocalFirewallRules: z.string(),
    }),
  ),
  networks: z.array(
    z.object({ name: z.string(), interfaceAlias: z.string(), category: z.string() }),
  ),
})

const DEFAULT_PROFILE: ProfileSettings = {
  enabled: true,
  defaultInboundAllow: false,
  allowInboundRules: true,
  allowLocalRules: true,
}

/** Validates and converts the query script's JSON. Throws when it is not what the script prints. */
export function parseSnapshot(json: string): FirewallSnapshot {
  const data = SnapshotJson.parse(JSON.parse(json.replace(/^﻿/, '')))
  const rules = (raw: string[]) => raw.map(parseRule).filter((rule) => rule !== null)
  const profiles: Record<FirewallProfile, ProfileSettings> = {
    domain: DEFAULT_PROFILE,
    private: DEFAULT_PROFILE,
    public: DEFAULT_PROFILE,
  }
  for (const p of data.profiles) {
    // "NotConfigured" (and anything unexpected) falls back to Windows' defaults.
    profiles[p.name.toLowerCase() as FirewallProfile] = {
      enabled: p.enabled !== 'False',
      defaultInboundAllow: p.defaultInboundAction === 'Allow',
      allowInboundRules: p.allowInboundRules !== 'False',
      allowLocalRules: p.allowLocalFirewallRules !== 'False',
    }
  }
  return {
    localRules: rules(data.local),
    policyRules: rules(data.policy),
    profiles,
    networks: data.networks.map((n) => ({
      name: n.name,
      interfaceAlias: n.interfaceAlias,
      category:
        n.category === 'Private'
          ? 'private'
          : n.category === 'DomainAuthenticated'
            ? 'domain'
            : 'public',
    })),
  }
}
