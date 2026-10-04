import type { ModelFamily, ModelPricing, PricingProvider } from '@shared/types/pricing'

export type SecretScanConsent = 'unasked' | 'granted' | 'declined'

// ─── App Preferences (stored in electron-store) ───────────────────────────────

export interface AppPreferences {
  pricingProvider: PricingProvider
  pricingOverrides: Partial<Record<ModelFamily, Partial<ModelPricing>>>
  costAlertThreshold?: number
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
  redactionLevel: 'none' | 'mask' | 'remove'
  launchAtLogin: boolean
  trayTipDismissed: boolean
  theme: 'light' | 'dark' | 'system'
  sidebarWidth: number
  windowBounds?: { width: number; height: number; x?: number; y?: number }
  /** App version the user last opened. Used to drive the What's New panel. */
  lastSeenVersion?: string
  /** Whether to send crash reports and feedback to Sentry. Opt-in, defaults to false. */
  sentryEnabled: boolean
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  pricingProvider: 'anthropic',
  pricingOverrides: {},
  secretScanEnabled: false,
  secretScanConsent: 'unasked',
  redactionLevel: 'mask',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  sentryEnabled: false,
}
