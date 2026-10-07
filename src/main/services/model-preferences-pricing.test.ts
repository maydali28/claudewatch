import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '@shared/types/preferences'
import type { ModelPreferences } from '@shared/types/pricing'
import { pricingFingerprint } from './pricing-engine'
import {
  ANTHROPIC_PRICING,
  estimateCost,
  getActivePricingTable,
  modelRate,
  resolveModelFamily,
} from '@shared/constants/pricing'

const ARN = 'arn:aws:bedrock:eu-central-1:123:application-inference-profile/abc'

function table(modelPreferences: ModelPreferences, pricingOverrides = {}) {
  return getActivePricingTable({ ...DEFAULT_PREFERENCES, pricingOverrides, modelPreferences })
}

describe('model preferences', () => {
  it('prices a mapped model at its family rates', () => {
    const t = table({ [ARN]: { family: 'sonnet-4-5' } })
    expect(resolveModelFamily(ARN, t)).toBe('sonnet-4-5')
    expect(estimateCost('sonnet-4-5', 1_000_000, 0, 0, 0, 0, t, ARN)).toBe(3)
  })

  it('leaves an unmapped custom ID unpriced', () => {
    const t = table({})
    expect(resolveModelFamily(ARN, t)).toBe('unknown')
    expect(estimateCost('unknown', 1_000_000, 0, 0, 0, 0, t, ARN)).toBeNull()
  })

  it('lays a model’s own rates over its family’s, after family overrides', () => {
    const t = table(
      { [ARN]: { family: 'sonnet-4-5', rates: { output: 12 } } },
      { 'sonnet-4-5': { input: 2.5 } }
    )
    expect(modelRate(t, ARN)).toMatchObject({ family: 'sonnet-4-5', input: 2.5, output: 12 })
    // The family itself keeps its own rates.
    expect(t['sonnet-4-5'].output).toBe(15)
  })

  it('prices an unknown-family model only when its own rates are complete', () => {
    const partial = table({ [ARN]: { rates: { input: 1, output: 2 } } })
    expect(modelRate(partial, ARN)).toBeUndefined()

    const full = { input: 1, output: 2, cacheRead: 0.1, cache5m: 1.25, cache1h: 2 }
    const t = table({ [ARN]: { rates: full } })
    expect(resolveModelFamily(ARN, t)).toBe('unknown')
    expect(estimateCost('unknown', 0, 1_000_000, 0, 0, 0, t, ARN)).toBe(2)
  })

  it('ignores a family name this build does not know', () => {
    const t = table({ [ARN]: { family: 'opus-9' as never } })
    expect(modelRate(t, ARN)).toBeUndefined()
  })

  it('adds no entry for a display name alone', () => {
    const t = table({ 'claude-sonnet-4-5': { displayName: 'Work Sonnet' } })
    expect(pricingFingerprint(t)).toBe(pricingFingerprint(ANTHROPIC_PRICING))
  })

  it('changes the pricing fingerprint when a mapping changes', () => {
    const a = pricingFingerprint(table({ [ARN]: { family: 'sonnet-4-5' } }))
    const b = pricingFingerprint(table({ [ARN]: { family: 'sonnet-4-6' } }))
    expect(a).not.toBe(b)
    expect(a).not.toBe(pricingFingerprint(table({})))
  })
})
