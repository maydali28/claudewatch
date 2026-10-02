import type { AppPreferences, ModelFamily, ModelPricing } from '@shared/types'

export type PricingOverrides = AppPreferences['pricingOverrides']

export type RateInput =
  { kind: 'clear' } | { kind: 'value'; value: number } | { kind: 'invalid'; message: string }

// An empty field means "use the default rate", so it clears the override
// rather than being ignored (roadmap #46: a blanked field used to be dropped
// before it reached the store, leaving the old override in place).
export function parseRateInput(raw: string): RateInput {
  const text = raw.trim()
  if (text === '') return { kind: 'clear' }
  const value = Number(text)
  if (!Number.isFinite(value)) return { kind: 'invalid', message: 'Enter a number' }
  if (value < 0) return { kind: 'invalid', message: 'Use 0 or more' }
  return { kind: 'value', value }
}

// Returns a new overrides map with one field set or removed. A value equal to
// the default rate is stored as no override, and a family whose last field
// goes is dropped, so the map only ever holds rates that differ from the table.
export function applyOverrideEdit(
  overrides: PricingOverrides,
  family: ModelFamily,
  field: keyof ModelPricing,
  value: number | undefined,
  defaultRate: number
): PricingOverrides {
  const fields: Partial<ModelPricing> = { ...overrides[family] }
  if (value === undefined || value === defaultRate) {
    delete fields[field]
  } else {
    fields[field] = value
  }

  const next: PricingOverrides = { ...overrides }
  if (Object.keys(fields).length === 0) {
    delete next[family]
  } else {
    next[family] = fields
  }
  return next
}

export function resetFamilyOverrides(
  overrides: PricingOverrides,
  family: ModelFamily
): PricingOverrides {
  const next: PricingOverrides = { ...overrides }
  delete next[family]
  return next
}

export function countOverriddenFields(overrides: PricingOverrides): number {
  return Object.values(overrides).reduce(
    (total, fields) => total + (fields ? Object.keys(fields).length : 0),
    0
  )
}
