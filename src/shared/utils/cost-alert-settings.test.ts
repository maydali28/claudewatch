import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '@shared/types/preferences'
import { costAlertThresholds, resolveCostAlertSettings } from './cost-alert-settings'

const prefs = (over: Partial<typeof DEFAULT_PREFERENCES>) => ({ ...DEFAULT_PREFERENCES, ...over })

describe('resolveCostAlertSettings', () => {
  it('is all off by default, with the default amounts and notifications on', () => {
    expect(resolveCostAlertSettings(DEFAULT_PREFERENCES)).toEqual({
      enabled: false,
      daily: { on: false, amount: 25 },
      session: { on: false, amount: 10 },
      notify: true,
    })
  })

  it('reads a daily threshold set before the switches existed as on', () => {
    const r = resolveCostAlertSettings(prefs({ costAlertThreshold: 40 }))
    expect(r.enabled).toBe(true)
    expect(r.daily).toEqual({ on: true, amount: 40 })
  })

  it('keeps an amount when its alert is switched off', () => {
    const r = resolveCostAlertSettings(
      prefs({ costAlertsEnabled: true, dailyCostAlertEnabled: false, costAlertThreshold: 40 })
    )
    expect(r.daily).toEqual({ on: false, amount: 40 })
  })

  it('treats a stored 0 amount as the default amount', () => {
    expect(resolveCostAlertSettings(prefs({ sessionCostAlertThreshold: 0 })).session.amount).toBe(
      10
    )
  })
})

describe('costAlertThresholds', () => {
  it('passes only the alerts that are on, and nothing while the master switch is off', () => {
    const on = prefs({
      costAlertsEnabled: true,
      dailyCostAlertEnabled: true,
      sessionCostAlertEnabled: false,
      costAlertThreshold: 30,
    })
    expect(costAlertThresholds(on)).toEqual({ daily: 30, session: 0 })
    expect(costAlertThresholds({ ...on, costAlertsEnabled: false })).toEqual({
      daily: 0,
      session: 0,
    })
  })
})
