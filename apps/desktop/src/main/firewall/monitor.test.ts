import { describe, expect, it, vi } from 'vitest'
import type { FirewallAllowResult, FirewallState } from '../../shared/firewall.ts'
import { FirewallMonitor } from './monitor.ts'
import { type FirewallSnapshot, type ProfileSettings, parseRule } from './rules.ts'

const PROGRAM = 'C:\\Program Files\\ShiftPane\\shiftpane.exe'
const PROFILE: ProfileSettings = {
  enabled: true,
  defaultInboundAllow: false,
  allowInboundRules: true,
  allowLocalRules: true,
}

function snapshot(rules: string[]): FirewallSnapshot {
  return {
    localRules: rules.map((raw) => parseRule(raw)).filter((rule) => rule !== null),
    policyRules: [],
    profiles: { domain: PROFILE, private: PROFILE, public: PROFILE },
    networks: [{ name: 'HomeWifi', interfaceAlias: 'Wi-Fi', category: 'private' }],
  }
}

const ALLOW_RULE = `v2.33|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Private|App=${PROGRAM}|Name=ShiftPane|`

function setup(allow: () => Promise<FirewallAllowResult> = async () => 'allowed') {
  let rules: string[] = []
  const query = vi.fn(async () => snapshot(rules))
  const monitor = new FirewallMonitor({ program: PROGRAM, env: {}, query, allow })
  const states: FirewallState[] = []
  monitor.on('change', (state) => states.push(state))
  return {
    monitor,
    query,
    states,
    setRules: (next: string[]) => {
      rules = next
    },
  }
}

describe('FirewallMonitor', () => {
  it('checks when the port or adapter changes, not on every pairing update', async () => {
    const { monitor, query, states } = setup()
    monitor.setTarget({ port: 47820, interfaceAlias: 'Wi-Fi' })
    await monitor.check()
    expect(states.at(-1)).toMatchObject({ status: 'blocked', reason: 'no-rule', port: 47820 })

    const calls = query.mock.calls.length
    monitor.setTarget({ port: 47820, interfaceAlias: 'Wi-Fi' })
    expect(query.mock.calls.length).toBe(calls)

    monitor.setTarget({ port: 51234, interfaceAlias: 'Wi-Fi' })
    await monitor.check()
    expect(monitor.state).toMatchObject({ port: 51234 })
  })

  it('rechecks after the rule is added', async () => {
    const { monitor, setRules, states } = setup()
    monitor.setTarget({ port: 47820, interfaceAlias: 'Wi-Fi' })
    await monitor.check()
    setRules([ALLOW_RULE])
    await expect(monitor.allow()).resolves.toBe('allowed')
    expect(states.at(-1)).toEqual({ status: 'ok' })
  })

  it('leaves the state alone when the UAC prompt is declined', async () => {
    const { monitor, query } = setup(async () => 'cancelled')
    monitor.setTarget({ port: 47820, interfaceAlias: 'Wi-Fi' })
    await monitor.check()
    const calls = query.mock.calls.length
    await expect(monitor.allow()).resolves.toBe('cancelled')
    expect(query.mock.calls.length).toBe(calls)
    expect(monitor.state.status).toBe('blocked')
  })

  it('reports unknown rather than a false alarm when the check fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const monitor = new FirewallMonitor({
      program: PROGRAM,
      env: {},
      query: async () => {
        throw new Error('powershell.exe not found')
      },
      allow: async () => 'failed',
    })
    monitor.setTarget({ port: 47820, interfaceAlias: 'Wi-Fi' })
    await monitor.check()
    expect(monitor.state).toEqual({ status: 'unknown' })
    warn.mockRestore()
  })
})
