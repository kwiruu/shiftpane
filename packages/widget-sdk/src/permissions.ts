import type { Permissions } from './manifest.ts'
import { actions, sources } from './sources.ts'

/**
 * Permissions in plain words, the way the app's install prompt says them: "Reads your GPU load.
 * Can reach api.github.com. Needs your GITHUB_TOKEN."
 */

export type PermissionKind = 'source' | 'action' | 'local' | 'network' | 'secret'

export interface PermissionLine {
  kind: PermissionKind
  /** The raw value: a source name, an action, a host or a secret name. */
  value: string
  text: string
  /** Installing asks about this one first. */
  asks: boolean
}

const isLoopback = (hostPort: string) => /^(127\.|localhost(:|$)|\[::1\])/.test(hostPort)

export function describePermissions(permissions: Permissions): PermissionLine[] {
  return [
    ...permissions.sources.map((name) => ({
      kind: 'source' as const,
      value: name,
      text: sources[name].phrase,
      asks: sources[name].asks,
    })),
    ...permissions.actions.map((name) => ({
      kind: 'action' as const,
      value: name,
      text: actions[name].phrase,
      asks: false,
    })),
    ...permissions.local.map((hostPort) => ({
      kind: 'local' as const,
      value: hostPort,
      text: `Can reach ${hostPort} ${isLoopback(hostPort) ? 'on your PC' : 'on your network'}`,
      asks: true,
    })),
    ...permissions.network.map((host) => ({
      kind: 'network' as const,
      value: host,
      text: `Can reach ${host}`,
      asks: false,
    })),
    ...permissions.secrets.map((name) => ({
      kind: 'secret' as const,
      value: name,
      text: `Needs your ${name}`,
      asks: false,
    })),
  ]
}

/**
 * The flow rule: a widget that reads something that reveals what you do and can also talk to a
 * host could send it off the PC. It gets a stronger prompt and always a human review.
 */
export function canSendOffPc(permissions: Permissions): boolean {
  const reveals = permissions.sources.some((name) => sources[name].asks)
  return reveals && (permissions.network.length > 0 || permissions.local.length > 0)
}

/** Whether installing shows a prompt before the widget runs. */
export function asksBeforeInstall(permissions: Permissions): boolean {
  return describePermissions(permissions).some((line) => line.asks)
}

/** Whether the widget needs nothing from the PC at all, like a clock. */
export function needsNothing(permissions: Permissions): boolean {
  return describePermissions(permissions).length === 0
}

/** What a newer version adds. An update that adds anything asks again; one that doesn't is silent. */
export function addedPermissions(previous: Permissions, next: Permissions): PermissionLine[] {
  const before = new Set(describePermissions(previous).map((line) => `${line.kind}:${line.value}`))
  return describePermissions(next).filter((line) => !before.has(`${line.kind}:${line.value}`))
}
