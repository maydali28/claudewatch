import type {
  ModelFamily,
  ModelPreferences,
  ModelPricing,
  PricingProvider,
} from '@shared/types/pricing'

export type SecretScanConsent = 'unasked' | 'granted' | 'declined'

// ─── App Preferences (stored in electron-store) ───────────────────────────────

export interface AppPreferences {
  pricingProvider: PricingProvider
  pricingOverrides: Partial<Record<ModelFamily, Partial<ModelPricing>>>
  /**
   * Settings › Models: per exact model ID, the family it counts as, rates of
   * its own and a display name. For IDs the built-in table cannot place, such
   * as gateway aliases, Bedrock ARNs and Foundry deployment names.
   */
  modelPreferences: ModelPreferences
  /** Settings › Cost alerts daily budget in USD; 0 or unset uses the default amount. */
  costAlertThreshold?: number
  /** Settings › Cost alerts per-session limit in USD; 0 or unset uses the default amount. */
  sessionCostAlertThreshold?: number
  /**
   * Settings › Cost alerts switches. Unset reads through
   * `resolveCostAlertSettings`, so a daily threshold saved before they
   * existed keeps its alert on.
   */
  costAlertsEnabled?: boolean
  dailyCostAlertEnabled?: boolean
  sessionCostAlertEnabled?: boolean
  /** Also show cost alerts as system notifications; unset is on. */
  costAlertNotify?: boolean
  /**
   * The Settings › Security switch for scanning transcripts for leaked
   * secrets. Scanning runs only while this is on AND `secretScanConsent` is
   * `granted`: a `true` stored by 1.5.0, before anyone was asked, is reset on
   * load (see `Preferences.load`).
   */
  secretScanEnabled: boolean
  /**
   * Whether the user has been asked about secret scanning, and what they
   * said. `unasked` shows the one-time prompt; turning the switch on records
   * `granted`, "Not now" records `declined`.
   */
  secretScanConsent: SecretScanConsent
  /** Also show a system notification for a new finding while ClaudeWatch is not focused. */
  secretScanNotify: boolean
  redactionLevel: 'none' | 'mask' | 'remove'
  launchAtLogin: boolean
  trayTipDismissed: boolean
  theme: 'light' | 'dark' | 'system'
  sidebarWidth: number
  windowBounds?: { width: number; height: number; x?: number; y?: number }
  /** App version the user last opened. Used to drive the What's New panel. */
  lastSeenVersion?: string
  /**
   * The Claude folder chosen in Settings › Claude folder. Absent: the
   * environment's `CLAUDE_CONFIG_DIR`, then `~/.claude/settings.json`'s, then
   * `~/.claude`.
   */
  claudeDirOverride?: string
  /** Whether to send crash reports and feedback to Sentry. Opt-in, defaults to false. */
  sentryEnabled: boolean
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  pricingProvider: 'anthropic',
  pricingOverrides: {},
  modelPreferences: {},
  secretScanEnabled: false,
  secretScanConsent: 'unasked',
  secretScanNotify: true,
  redactionLevel: 'mask',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  sentryEnabled: false,
}
