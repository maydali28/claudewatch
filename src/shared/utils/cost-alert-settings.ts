import type { AppPreferences } from '@shared/types/preferences'
import type { CostAlertThresholds } from '@shared/types/cost-alerts'

export const DEFAULT_DAILY_BUDGET = 25
export const DEFAULT_SESSION_LIMIT = 10

export interface CostAlertSettings {
  /** The Cost alerts master switch. */
  enabled: boolean
  daily: { on: boolean; amount: number }
  session: { on: boolean; amount: number }
  /** Also show a system notification when ClaudeWatch is in the background. */
  notify: boolean
}

const amount = (stored: number | undefined, fallback: number): number =>
  stored !== undefined && stored > 0 ? stored : fallback

/**
 * Settings › Cost alerts as the screen and the checks see it. The switches are
 * optional in the store: a daily threshold saved before they existed (when a
 * threshold above 0 was the only way to turn the alert on) reads as on.
 */
export function resolveCostAlertSettings(prefs: AppPreferences): CostAlertSettings {
  const legacyDaily = (prefs.costAlertThreshold ?? 0) > 0
  return {
    enabled: prefs.costAlertsEnabled ?? legacyDaily,
    daily: {
      on: prefs.dailyCostAlertEnabled ?? legacyDaily,
      amount: amount(prefs.costAlertThreshold, DEFAULT_DAILY_BUDGET),
    },
    session: {
      on: prefs.sessionCostAlertEnabled ?? false,
      amount: amount(prefs.sessionCostAlertThreshold, DEFAULT_SESSION_LIMIT),
    },
    notify: prefs.costAlertNotify ?? true,
  }
}

/** What the checks enforce: 0 for every alert that is off. */
export function costAlertThresholds(prefs: AppPreferences): CostAlertThresholds {
  const s = resolveCostAlertSettings(prefs)
  return {
    daily: s.enabled && s.daily.on ? s.daily.amount : 0,
    session: s.enabled && s.session.on ? s.session.amount : 0,
  }
}
