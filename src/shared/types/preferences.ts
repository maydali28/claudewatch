import type {
  ModelFamily,
  ModelPricing,
  PricingProvider,
  VertexRegion,
} from '@shared/types/pricing'

// ─── App Preferences (stored in electron-store) ───────────────────────────────

export interface AppPreferences {
  pricingProvider: PricingProvider
  pricingRegion: VertexRegion
  pricingOverrides: Partial<Record<ModelFamily, Partial<ModelPricing>>>
  costAlertThreshold?: number
  secretScanEnabled: boolean
  redactionLevel: 'none' | 'mask' | 'remove'
  launchAtLogin: boolean
  trayTipDismissed: boolean
  theme: 'light' | 'dark' | 'system'
  sidebarWidth: number
  windowBounds?: { width: number; height: number; x?: number; y?: number }
  alertedSecrets: string[]
  /** App version the user last opened. Used to drive the What's New panel. */
  lastSeenVersion?: string
  /** Whether to send crash reports and feedback to Sentry. Opt-in, defaults to false. */
  sentryEnabled: boolean
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  pricingProvider: 'anthropic',
  pricingRegion: 'us-east5',
  pricingOverrides: {},
  secretScanEnabled: true,
  redactionLevel: 'mask',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  alertedSecrets: [],
  sentryEnabled: false,
}
