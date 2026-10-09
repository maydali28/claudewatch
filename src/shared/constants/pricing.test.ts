import { describe, expect, it } from 'vitest'
import { ANTHROPIC_PRICING, estimateCost, getActivePricingTable } from './pricing'
import type { ModelFamily } from '@shared/types/pricing'

describe('ANTHROPIC_PRICING — published input/output rates', () => {
  const cases: Array<[ModelFamily, number, number]> = [
    ['fable-5-1', 10, 50],
    ['mythos-5-1', 10, 50],
    ['fable-5', 10, 50],
    ['opus-5-5', 4, 20],
    ['opus-5', 5, 25],
    ['opus-4-8', 5, 25],
    ['sonnet-5-5', 2, 10],
    ['sonnet-5', 2, 10],
    ['sonnet-4-6', 3, 15],
    ['haiku-5-5', 0.1, 0.5],
    ['haiku-4-5', 1, 5],
  ]

  it.each(cases)('%s is $%s in / $%s out per million', (family, input, output) => {
    expect(ANTHROPIC_PRICING[family].input).toBe(input)
    expect(ANTHROPIC_PRICING[family].output).toBe(output)
  })
})

/**
 * Cache reads are 0.1x input for every model except Fable 5.1 / Mythos 5.1
 * (0.025x, a flat $0.25 per million) and Opus 5.5 / Sonnet 5.5 (0.05x, $0.20
 * and $0.10 per million). Applying the usual multiplier there overcharges
 * cache reads fourfold and twofold respectively.
 */
describe('ANTHROPIC_PRICING — cache read rates', () => {
  it('prices Fable 5.1 cache reads at the documented $0.25, not 0.1x input', () => {
    expect(ANTHROPIC_PRICING['fable-5-1'].cacheRead).toBe(0.25)
  })

  // Assumed, not published: the documented exception names Fable 5.1. Pinned so
  // the assumption is visible and fails loudly if it is ever corrected.
  it('prices Mythos 5.1 cache reads at an assumed $0.25, matching Fable 5.1', () => {
    expect(ANTHROPIC_PRICING['mythos-5-1'].cacheRead).toBe(0.25)
  })

  it('prices Fable 5 cache reads at 0.1x input', () => {
    expect(ANTHROPIC_PRICING['fable-5'].cacheRead).toBe(1.0)
  })

  it('prices Opus 5.5 cache reads at the documented 0.05x input ($0.20), not 0.1x', () => {
    expect(ANTHROPIC_PRICING['opus-5-5'].cacheRead).toBe(0.2)
  })

  it('prices Opus 5 cache reads at 0.1x input', () => {
    expect(ANTHROPIC_PRICING['opus-5'].cacheRead).toBe(0.5)
  })

  it('prices Sonnet 5.5 cache reads at the documented 0.05x input ($0.10), not 0.1x', () => {
    expect(ANTHROPIC_PRICING['sonnet-5-5'].cacheRead).toBe(0.1)
  })

  it('prices Haiku 5.5 cache reads at 0.1x input in both prompt tiers', () => {
    expect(ANTHROPIC_PRICING['haiku-5-5'].cacheRead).toBe(0.01)
    expect(ANTHROPIC_PRICING['haiku-5-5'].longContext?.cacheRead).toBe(0.05)
  })

  it('prices Sonnet 5 cache reads at 0.1x input', () => {
    expect(ANTHROPIC_PRICING['sonnet-5'].cacheRead).toBe(0.2)
  })
})

describe('ANTHROPIC_PRICING — cache write tiers', () => {
  it.each([
    'fable-5-1',
    'mythos-5-1',
    'fable-5',
    'opus-5-5',
    'opus-5',
    'sonnet-5-5',
    'sonnet-5',
    'haiku-5-5',
  ] as ModelFamily[])('%s writes cost 1.25x input for 5m and 2x input for 1h', (family) => {
    const p = ANTHROPIC_PRICING[family]
    expect(p.cache5m).toBeCloseTo(p.input * 1.25, 10)
    expect(p.cache1h).toBeCloseTo(p.input * 2, 10)
  })
})

/**
 * Haiku 5.5 is priced by prompt length: a request whose prompt is over 100,000
 * tokens, counting cache reads and writes, pays $0.50 / $2.50 instead of
 * $0.10 / $0.50, on every pool of that request.
 */
describe('estimateCost — Haiku 5.5 prompt-length pricing', () => {
  const cost = (input: number, output: number, read = 0, w5 = 0, w1 = 0): number | null =>
    estimateCost('haiku-5-5', input, output, read, w5, w1, ANTHROPIC_PRICING)

  it('prices a prompt of exactly 100,000 tokens at the lower rates', () => {
    // 0.1 * 0.1 + 0.5 * 0.001
    expect(cost(100_000, 1_000)).toBeCloseTo(0.0105, 10)
  })

  it('prices every pool of a longer prompt at the higher rates', () => {
    // 0.5 * 0.100001 + 2.5 * 0.001
    expect(cost(100_001, 1_000)).toBeCloseTo(0.0525005, 10)
  })

  it('counts cache reads and writes toward the prompt length', () => {
    // 10K input + 80K read + 6K 5m + 5K 1h = 101K: over the threshold.
    // 0.5 * 0.01 + 2.5 * 0.001 + 0.05 * 0.08 + 0.625 * 0.006 + 1 * 0.005
    expect(cost(10_000, 1_000, 80_000, 6_000, 5_000)).toBeCloseTo(0.02025, 10)
  })

  it('leaves models without long-prompt rates at one rate', () => {
    expect(estimateCost('sonnet-5-5', 900_000, 0, 0, 0, 0, ANTHROPIC_PRICING)).toBeCloseTo(1.8, 10)
  })

  it('prices rates the user entered as entered, at any prompt length', () => {
    const table = getActivePricingTable({
      pricingProvider: 'anthropic',
      pricingOverrides: { 'haiku-5-5': { input: 0.2 } },
    })
    expect(estimateCost('haiku-5-5', 200_000, 0, 0, 0, 0, table)).toBeCloseTo(0.04, 10)
  })

  it('keeps the long-prompt rates for a model only mapped to Haiku 5.5', () => {
    const table = getActivePricingTable({
      pricingProvider: 'anthropic',
      pricingOverrides: {},
      modelPreferences: { 'my-gateway-haiku': { family: 'haiku-5-5' } },
    })
    expect(estimateCost('haiku-5-5', 200_000, 0, 0, 0, 0, table, 'my-gateway-haiku')).toBeCloseTo(
      0.1,
      10
    )
  })
})

describe('estimateCost', () => {
  it('sums all five token pools at their own rates', () => {
    const cost = estimateCost(
      'opus-5',
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000,
      ANTHROPIC_PRICING
    )
    // 5 + 25 + 0.5 + 6.25 + 10
    expect(cost).toBeCloseTo(46.75, 10)
  })

  it('returns 0 for a priced model with no usage', () => {
    expect(estimateCost('opus-5', 0, 0, 0, 0, 0, ANTHROPIC_PRICING)).toBe(0)
  })

  /**
   * An unrecognised model must not be silently priced at a fallback rate. That
   * is exactly how Opus 5 usage was reported at Sonnet rates without anything
   * looking wrong.
   */
  it('returns null for an unknown model rather than guessing a rate', () => {
    expect(estimateCost('unknown', 1_000_000, 1_000_000, 0, 0, 0, ANTHROPIC_PRICING)).toBeNull()
  })
})
