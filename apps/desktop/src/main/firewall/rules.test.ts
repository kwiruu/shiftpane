import { describe, expect, it } from 'vitest'
import {
  diagnose,
  evaluate,
  expandEnv,
  type FirewallSnapshot,
  type ProfileSettings,
  parseRule,
  parseSnapshot,
} from './rules.ts'

const ELECTRON =
  'C:\\Users\\Dev\\shiftpane\\node_modules\\.pnpm\\electron@44.7.1\\node_modules\\electron\\dist\\electron.exe'
const env = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\Dev\\AppData\\Local' }
const server = { program: ELECTRON, port: 47820 }

// Registry rule strings as Windows stores them (most copied from a real Windows 11 PC).
const RULES = {
  /** Added by hand with "New Inbound Rule": TCP 47820, private networks, any program. */
  devPort:
    'v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Private|LPort=47820|Name=ShiftPane dev (TCP 47820)|',
  /** Made by Windows' own "allow access" prompt: lowercased path, one rule per protocol. */
  promptAllowCode:
    'v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Public|App=C:\\users\\dev\\appdata\\local\\programs\\microsoft vs code\\code.exe|Name=Visual Studio Code|Desc=Visual Studio Code|Defer=User|',
  promptBlockElectron: `v2.10|Action=Block|Active=TRUE|Dir=In|Protocol=6|Profile=Public|App=${ELECTRON.toLowerCase()}|Name=Electron|Desc=Electron|Defer=User|`,
  /** What the Allow button and the installer add. */
  shiftpane: `v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Domain|Profile=Private|App=${ELECTRON}|Name=ShiftPane|Desc=Lets phones on your local network pair with ShiftPane.|`,
  frameServer:
    'v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|LPort=554|LPort2_10=8554-8558|RA4=LocalSubnet|RA6=LocalSubnet|App=%SystemRoot%\\system32\\svchost.exe|Svc=FrameServer|Name=@FirewallAPI.dll,-54002|Desc=@FirewallAPI.dll,-54003|EmbedCtxt=@FirewallAPI.dll,-54001|',
  wsd: 'v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Private|LPort=5357|RA4=LocalSubnet|RA6=LocalSubnet|App=System|Name=@FirewallAPI.dll,-32817|Desc=@FirewallAPI.dll,-32818|EmbedCtxt=@FirewallAPI.dll,-32752|',
  disabledSmb:
    'v2.33|Action=Allow|Active=FALSE|Dir=In|Protocol=6|Profile=Domain|LPort=445|App=System|Name=@FirewallAPI.dll,-29257|Desc=@FirewallAPI.dll,-29260|EmbedCtxt=@FirewallAPI.dll,-29252|',
}

const OPEN_PROFILE: ProfileSettings = {
  enabled: true,
  defaultInboundAllow: false,
  allowInboundRules: true,
  allowLocalRules: true,
}

function snapshot(local: string[], overrides: Partial<FirewallSnapshot> = {}): FirewallSnapshot {
  return {
    localRules: local.map((raw) => parseRule(raw)).filter((rule) => rule !== null),
    policyRules: [],
    profiles: { domain: OPEN_PROFILE, private: OPEN_PROFILE, public: OPEN_PROFILE },
    networks: [{ name: 'HomeWifi', interfaceAlias: 'Wi-Fi', category: 'private' }],
    ...overrides,
  }
}

describe('parseRule', () => {
  it('reads a rule made by Windows’ own prompt', () => {
    expect(parseRule(RULES.promptAllowCode)).toEqual({
      action: 'allow',
      enabled: true,
      inbound: true,
      protocol: 6,
      profiles: ['public'],
      localPorts: null,
      program: 'C:\\users\\dev\\appdata\\local\\programs\\microsoft vs code\\code.exe',
      conditional: false,
    })
  })

  it('collects repeated fields and every port format', () => {
    const rule = parseRule(RULES.frameServer)
    expect(rule?.localPorts).toEqual(['554', '8554-8558'])
    expect(rule?.profiles).toBeNull()
    expect(parseRule(RULES.shiftpane)?.profiles).toEqual(['domain', 'private'])
  })

  it('marks scopes it does not evaluate as conditional', () => {
    // Service-only rule.
    expect(parseRule(RULES.frameServer)?.conditional).toBe(true)
    // The local subnet is where phones are.
    expect(parseRule(RULES.wsd)?.conditional).toBe(false)
    expect(
      parseRule('v2.33|Action=Allow|Active=TRUE|Dir=In|RA4=10.1.2.3|Name=x|')?.conditional,
    ).toBe(true)
    expect(parseRule('v2.33|Action=Allow|Active=TRUE|Dir=In|RPort=80|Name=x|')?.conditional).toBe(
      true,
    )
    expect(
      parseRule('v2.33|Action=Allow|Active=TRUE|Dir=In|PFN=Some.App_8wekyb3d8bbwe|')?.conditional,
    ).toBe(true)
  })

  it('ignores strings that are not rules', () => {
    expect(parseRule('')).toBeNull()
    expect(parseRule('garbage|Action=Allow|')).toBeNull()
  })
})

describe('expandEnv', () => {
  it('expands variables without regard to case and keeps unknown ones', () => {
    expect(expandEnv('%systemroot%\\system32\\svchost.exe', env)).toBe(
      'C:\\Windows\\system32\\svchost.exe',
    )
    expect(expandEnv('%NOPE%\\x.exe', env)).toBe('%NOPE%\\x.exe')
  })
})

describe('evaluate', () => {
  it('lets a port rule through only on its port and profile', () => {
    const fw = snapshot([RULES.devPort])
    expect(evaluate(fw, server, 'private', env)).toEqual({ open: true })
    // Random-port fallback when 47820 is taken: the port rule no longer covers it.
    expect(evaluate(fw, { ...server, port: 51234 }, 'private', env)).toEqual({
      open: false,
      reason: 'no-rule',
    })
    expect(evaluate(fw, server, 'public', env)).toEqual({ open: false, reason: 'no-rule' })
  })

  it('matches program rules on any port, by path without case or %VARIABLES%', () => {
    const fw = snapshot([RULES.shiftpane])
    expect(evaluate(fw, { ...server, port: 51234 }, 'private', env)).toEqual({ open: true })
    expect(evaluate(fw, { ...server, program: ELECTRON.toUpperCase() }, 'domain', env)).toEqual({
      open: true,
    })
    const viaVariable = snapshot([
      'v2.33|Action=Allow|Active=TRUE|Dir=In|App=%LocalAppData%\\Programs\\shiftpane\\shiftpane.exe|Name=ShiftPane|',
    ])
    expect(
      evaluate(
        viaVariable,
        {
          program: 'C:\\Users\\Dev\\AppData\\Local\\Programs\\shiftpane\\shiftpane.exe',
          port: 47820,
        },
        'private',
        env,
      ),
    ).toEqual({ open: true })
    expect(evaluate(fw, { ...server, program: 'C:\\other\\electron.exe' }, 'private', env)).toEqual(
      {
        open: false,
        reason: 'no-rule',
      },
    )
  })

  it('skips disabled, outbound, UDP and conditional rules', () => {
    const fw = snapshot([
      RULES.disabledSmb.replace('LPort=445', 'LPort=47820').replace('App=System|', ''),
      'v2.33|Action=Allow|Active=TRUE|Dir=Out|Protocol=6|LPort=47820|Name=out|',
      'v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=17|LPort=47820|Name=udp|',
      'v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|LPort=47820|Svc=fdphost|Name=svc|',
    ])
    expect(evaluate(fw, server, 'domain', env)).toEqual({ open: false, reason: 'no-rule' })
  })

  it('lets block rules win over allow rules', () => {
    const fw = snapshot([RULES.shiftpane, RULES.promptBlockElectron])
    expect(evaluate(fw, server, 'private', env)).toEqual({ open: true })
    const blockedEverywhere = RULES.promptBlockElectron.replace('|Profile=Public', '')
    expect(
      evaluate(snapshot([RULES.shiftpane, blockedEverywhere]), server, 'private', env),
    ).toEqual({
      open: false,
      reason: 'block-rule',
    })
  })

  it('reports what a local rule cannot fix', () => {
    const shielded = snapshot([RULES.shiftpane], {
      profiles: {
        domain: OPEN_PROFILE,
        private: { ...OPEN_PROFILE, allowInboundRules: false },
        public: OPEN_PROFILE,
      },
    })
    expect(evaluate(shielded, server, 'private', env)).toEqual({
      open: false,
      reason: 'all-inbound-blocked',
    })

    const managed = snapshot([RULES.shiftpane], {
      profiles: {
        domain: OPEN_PROFILE,
        private: { ...OPEN_PROFILE, allowLocalRules: false },
        public: OPEN_PROFILE,
      },
    })
    expect(evaluate(managed, server, 'private', env)).toEqual({ open: false, reason: 'managed' })

    const policyBlock = snapshot([RULES.shiftpane], {
      policyRules: [
        parseRule('v2.33|Action=Block|Active=TRUE|Dir=In|Protocol=6|LPort=47820|Name=gp|'),
      ].filter((rule) => rule !== null),
    })
    expect(evaluate(policyBlock, server, 'private', env)).toEqual({
      open: false,
      reason: 'managed',
    })
  })

  it('is open when the firewall is off or allows inbound by default', () => {
    const off = snapshot([], {
      profiles: {
        domain: OPEN_PROFILE,
        private: { ...OPEN_PROFILE, enabled: false },
        public: OPEN_PROFILE,
      },
    })
    expect(evaluate(off, server, 'private', env)).toEqual({ open: true })
    const allowByDefault = snapshot([], {
      profiles: {
        domain: OPEN_PROFILE,
        private: { ...OPEN_PROFILE, defaultInboundAllow: true },
        public: OPEN_PROFILE,
      },
    })
    expect(evaluate(allowByDefault, server, 'private', env)).toEqual({ open: true })
  })
})

describe('diagnose', () => {
  it('asks to allow ShiftPane on a private network without a rule', () => {
    expect(diagnose(snapshot([RULES.wsd, RULES.promptAllowCode]), server, 'Wi-Fi', env)).toEqual({
      status: 'blocked',
      reason: 'no-rule',
      port: 47820,
      network: { name: 'HomeWifi', category: 'private' },
      canAllow: true,
    })
  })

  it('is ok when a rule covers the network in use', () => {
    expect(diagnose(snapshot([RULES.devPort]), server, 'Wi-Fi', env)).toEqual({ status: 'ok' })
  })

  it('points at the network type on a public network', () => {
    const publicWifi = [{ name: 'Cafe', interfaceAlias: 'Wi-Fi', category: 'public' as const }]
    // A private rule exists, so making the network Private is enough.
    expect(
      diagnose(snapshot([RULES.shiftpane], { networks: publicWifi }), server, 'Wi-Fi', env),
    ).toEqual({
      status: 'blocked',
      reason: 'public-network',
      port: 47820,
      network: { name: 'Cafe', category: 'public' },
      canAllow: false,
    })
    // No rule anywhere: the network type and a rule are both needed.
    expect(diagnose(snapshot([], { networks: publicWifi }), server, 'Wi-Fi', env)).toMatchObject({
      reason: 'public-network',
      canAllow: true,
    })
  })

  it('treats an adapter Windows has no network profile for as public', () => {
    expect(diagnose(snapshot([RULES.shiftpane]), server, 'Ethernet 3', env)).toMatchObject({
      status: 'blocked',
      reason: 'public-network',
      network: null,
      canAllow: false,
    })
  })

  it('names the real port after the random-port fallback', () => {
    expect(
      diagnose(snapshot([RULES.devPort]), { ...server, port: 51234 }, 'Wi-Fi', env),
    ).toMatchObject({
      reason: 'no-rule',
      port: 51234,
    })
  })
})

describe('parseSnapshot', () => {
  // Shape of the query script's output on Windows 11 (rules trimmed).
  const output = JSON.stringify({
    local: [RULES.devPort, RULES.promptAllowCode, RULES.frameServer],
    policy: [],
    profiles: [
      {
        name: 'Domain',
        enabled: 'True',
        defaultInboundAction: 'Block',
        allowInboundRules: 'True',
        allowLocalFirewallRules: 'True',
      },
      {
        name: 'Private',
        enabled: 'True',
        defaultInboundAction: 'NotConfigured',
        allowInboundRules: 'NotConfigured',
        allowLocalFirewallRules: 'False',
      },
      {
        name: 'Public',
        enabled: 'False',
        defaultInboundAction: 'Allow',
        allowInboundRules: 'False',
        allowLocalFirewallRules: 'True',
      },
    ],
    networks: [
      { name: 'cabiliwifi_5G 4', interfaceAlias: 'Wi-Fi 2', category: 'Private' },
      { name: 'corp.example', interfaceAlias: 'Ethernet', category: 'DomainAuthenticated' },
      { name: 'Unidentified network', interfaceAlias: 'vEthernet (WSL)', category: 'Public' },
    ],
  })

  it('converts profiles, networks and rules', () => {
    const fw = parseSnapshot(output)
    expect(fw.localRules).toHaveLength(3)
    expect(fw.profiles).toEqual({
      domain: {
        enabled: true,
        defaultInboundAllow: false,
        allowInboundRules: true,
        allowLocalRules: true,
      },
      private: {
        enabled: true,
        defaultInboundAllow: false,
        allowInboundRules: true,
        allowLocalRules: false,
      },
      public: {
        enabled: false,
        defaultInboundAllow: true,
        allowInboundRules: false,
        allowLocalRules: true,
      },
    })
    expect(fw.networks.map((n) => [n.interfaceAlias, n.category])).toEqual([
      ['Wi-Fi 2', 'private'],
      ['Ethernet', 'domain'],
      ['vEthernet (WSL)', 'public'],
    ])
  })

  it('tolerates a byte-order mark and missing profiles', () => {
    const fw = parseSnapshot(
      `\uFEFF${JSON.stringify({ local: [], policy: [], profiles: [], networks: [] })}`,
    )
    expect(fw.profiles.public).toEqual(OPEN_PROFILE)
  })

  it('rejects output that is not from the query script', () => {
    expect(() => parseSnapshot('')).toThrow()
    expect(() =>
      parseSnapshot('{"local":"v2.33|","policy":[],"profiles":[],"networks":[]}'),
    ).toThrow()
    expect(() =>
      parseSnapshot('{"local":[],"policy":[],"profiles":[{"name":"Home"}],"networks":[]}'),
    ).toThrow()
  })
})
