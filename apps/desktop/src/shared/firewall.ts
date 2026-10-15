/** Windows Firewall status the main process pushes to the desktop window. Types only: shared by main, preload and renderer. */

export type NetworkCategory = 'public' | 'private' | 'domain'

/** Why phones cannot reach the pairing server. */
export type FirewallBlockReason =
  /** Inbound is blocked by default and no allow rule covers ShiftPane on this port. */
  | 'no-rule'
  /** A block rule matches ShiftPane; it wins over any allow rule. */
  | 'block-rule'
  /** The network is Public and nothing allows ShiftPane there. */
  | 'public-network'
  /** "Block all incoming connections, including those in the list of allowed apps" is on. */
  | 'all-inbound-blocked'
  /** Group Policy ignores local rules, so ShiftPane cannot add one. */
  | 'managed'

export type FirewallState =
  /** Not Windows, not checked yet, or the check failed: nothing to show. */
  | { status: 'unknown' }
  | { status: 'ok' }
  | {
      status: 'blocked'
      reason: FirewallBlockReason
      /** The port the server actually listens on (not always the default). */
      port: number
      /** The network the QR code points phones at, as Windows names it. */
      network: { name: string; category: NetworkCategory } | null
      /** The elevated "Allow" action would fix this, or the part of it that is not the network type. */
      canAllow: boolean
    }

export type FirewallAllowResult = 'allowed' | 'cancelled' | 'failed'

/** Windows settings pages the firewall notice can open. */
export const SETTINGS_PAGES = ['network', 'firewall'] as const
export type SettingsPage = (typeof SETTINGS_PAGES)[number]
