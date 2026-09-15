import { describe, expect, it } from 'vitest'
import type { ModelEfficiencyRow } from '@shared/types'
import { DEFAULT_PREFERENCES } from '@shared/types'
import { ANTHROPIC_PRICING, getActivePricingTable } from '@shared/constants/pricing'
import { projectCost, formatWhatIfDelta } from './whatif-calculator'

/**
 * Fable 5 and Fable 5.1 bill identical input ($10/MTok) and output ($50/MTok)
 * rates, so a calculator that scales total spend by (input+output) predicts
 * zero change between them. Their cache READ rates differ fourfold — $1 vs
 * $0.25 per MTok — which is the whole story on a cache-dominated workload.
 */
describe('projectCost', () => {
  it('prices a fable 5 to fable 5.1 switch from the cache read rate', () => {
    const row: ModelEfficiencyRow = {
      id: 'fable-5',
      model: 'claude-fable-5',
      turnCount: 1,
      inputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheCreationUnknownTtlTokens: 0,
      totalOutputTokens: 0,
      avgOutputPerTurn: 0,
      totalCost: 1,
      costPerTurn: 1,
      percentOfTotalCost: 100,
    }

    // 1,000,000 cache-read tokens at fable-5's $1.00/MTok read rate = $1.00,
    // matching row.totalCost. At fable-5-1's $0.25/MTok read rate that same
    // workload reprices to $0.25 — a 75% drop.
    const result = projectCost(row, 'fable-5', 'fable-5-1', ANTHROPIC_PRICING)
    expect(result?.projectedTotal).toBeCloseTo(0.25, 6)
    expect(result?.deltaCost).toBeCloseTo(-0.75, 6)
    expect(result?.deltaPct).toBeCloseTo(-75, 4)
  })

  it('returns null for an unrecognised target model', () => {
    const row: ModelEfficiencyRow = {
      id: 'sonnet-5',
      model: 'claude-sonnet-5',
      turnCount: 1,
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheCreationUnknownTtlTokens: 0,
      totalOutputTokens: 0,
      avgOutputPerTurn: 0,
      totalCost: 2,
      costPerTurn: 2,
      percentOfTotalCost: 100,
    }

    expect(projectCost(row, 'sonnet-5', 'not-a-real-model', ANTHROPIC_PRICING)).toBeNull()
  })

  /**
   * Headline regression for the ordering defect: `ModelEfficiencyRow` grew
   * `cacheCreation5mTokens`/`cacheCreation1hTokens` before unknown-TTL cache
   * writes existed, so a row of pure unsplit writes carried no field for
   * `projectCost` to reprice. A same-model projection is a tautology — the
   * source and target rates are identical — so it must always be a no-op.
   *
   * Hand arithmetic (Sonnet 5: input $2, output $10, cacheRead $0.20,
   * cache5m $2.50, cache1h $4.00 per MTok — src/shared/constants/pricing.ts):
   *   actual cost   = 1,000,000 unsplit-write tokens, no known TTL, priced at
   *                   the 5-minute fallback rate = (1,000,000/1e6) * 2.50
   *                 = $2.50
   *   projected cost (sonnet-5 -> sonnet-5) must reprice that same remainder
   *   at the same fallback rate = (1,000,000/1e6) * 2.50 = $2.50
   *   delta = 2.50 - 2.50 = $0.00 (0%)
   *
   * Before the fix, `projectCost` had no unknown-TTL term at all, so
   * `projectedTotal` came out to $0.00 against a $2.50 actual cost — a false
   * 100% saving for repricing a model onto itself.
   */
  it('projects a pure unsplit-cache-write row onto itself as a no-op', () => {
    const row: ModelEfficiencyRow = {
      id: 'sonnet-5',
      model: 'sonnet-5',
      turnCount: 1,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheCreationUnknownTtlTokens: 1_000_000,
      totalOutputTokens: 0,
      avgOutputPerTurn: 0,
      totalCost: 2.5,
      costPerTurn: 2.5,
      percentOfTotalCost: 100,
    }

    const result = projectCost(row, 'sonnet-5', 'sonnet-5', ANTHROPIC_PRICING)
    expect(result?.projectedTotal).toBeCloseTo(2.5, 6)
    expect(result?.deltaCost).toBeCloseTo(0, 6)
    expect(result?.deltaPct).toBeCloseTo(0, 6)
  })

  /**
   * Same identity, now under a user rate override, to catch the second half
   * of the defect: `projectCost` used to read the built-in `ANTHROPIC_PRICING`
   * constant directly instead of the caller's active table, so an override
   * moved `sourceRow.totalCost` (priced elsewhere from the active table) but
   * not the projection, producing a nonzero delta for a same-model comparison.
   *
   * Hand arithmetic with an override doubling Sonnet 5's input rate from
   * $2.00 to $20.00/MTok (cache5m stays the base $2.50, cache1h $4.00,
   * cacheRead $0.20, output $10.00 — only `input` is overridden), one million
   * tokens in every pool:
   *   input           = (1,000,000/1e6) * 20.00 = 20.00
   *   output          = (1,000,000/1e6) * 10.00 = 10.00
   *   cacheRead       = (1,000,000/1e6) *  0.20 =  0.20
   *   cache5m         = (1,000,000/1e6) *  2.50 =  2.50
   *   cache1h         = (1,000,000/1e6) *  4.00 =  4.00
   *   unknownTtl (@cache5m rate) = (1,000,000/1e6) * 2.50 = 2.50
   *   total = 20.00 + 10.00 + 0.20 + 2.50 + 4.00 + 2.50 = $39.20
   *
   * `sourceRow.totalCost` is set to that same $39.20, standing in for a value
   * the main process already priced from the active table. Projecting
   * sonnet-5 -> sonnet-5 at the active table must reproduce exactly $39.20,
   * a $0.00 / 0% delta.
   *
   * Before the fix (reading `ANTHROPIC_PRICING` directly, ignoring the
   * override), the projection would price the input leg at the built-in
   * $2.00 instead of $20.00: 2.00 + 10.00 + 0.20 + 2.50 + 4.00 + 2.50 =
   * $21.20 projected against a $39.20 actual — an $18.00 / -45.9% "saving"
   * for repricing a model onto itself.
   */
  it('stays a no-op for a same-model projection when a pricing override is active', () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      pricingOverrides: { 'sonnet-5': { input: 20.0 } },
    }
    const activeTable = getActivePricingTable(prefs)
    expect(activeTable['sonnet-5'].input).toBe(20.0)

    const row: ModelEfficiencyRow = {
      id: 'sonnet-5',
      model: 'sonnet-5',
      turnCount: 1,
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreation5mTokens: 1_000_000,
      cacheCreation1hTokens: 1_000_000,
      cacheCreationUnknownTtlTokens: 1_000_000,
      totalOutputTokens: 1_000_000,
      avgOutputPerTurn: 1_000_000,
      totalCost: 39.2,
      costPerTurn: 39.2,
      percentOfTotalCost: 100,
    }

    const result = projectCost(row, 'sonnet-5', 'sonnet-5', activeTable)
    expect(result?.projectedTotal).toBeCloseTo(39.2, 6)
    expect(result?.deltaCost).toBeCloseTo(0, 6)
    expect(result?.deltaPct).toBeCloseTo(0, 6)
  })

  /**
   * `'unknown'` has a real (all-zero) entry in every pricing table, so a guard
   * that only checks "does the table have this key" lets it through as a
   * free model instead of refusing to project — the same asymmetry the
   * aggregate cache-premium loops in analytics-engine.ts guard against
   * explicitly (`m.family === 'unknown'`, not just `!p`).
   */
  it('refuses to project to or from the unknown family even though it has a zeroed pricing entry', () => {
    const row: ModelEfficiencyRow = {
      id: 'unknown',
      model: 'unknown',
      turnCount: 1,
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheCreationUnknownTtlTokens: 0,
      totalOutputTokens: 0,
      avgOutputPerTurn: 0,
      totalCost: 5,
      costPerTurn: 5,
      percentOfTotalCost: 100,
    }

    expect(projectCost(row, 'unknown', 'sonnet-5', ANTHROPIC_PRICING)).toBeNull()
    expect(projectCost(row, 'sonnet-5', 'unknown', ANTHROPIC_PRICING)).toBeNull()
  })
})

describe('formatWhatIfDelta', () => {
  it('renders a real negative delta with a minus sign', () => {
    expect(formatWhatIfDelta(-0.75, -75)).toBe('-$0.75 (-75.0%)')
  })

  it('renders a real positive delta with a plus sign', () => {
    expect(formatWhatIfDelta(1.5, 33.3)).toBe('+$1.50 (33.3%)')
  })

  it('renders an exact-zero delta as a plain no-op', () => {
    expect(formatWhatIfDelta(0, 0)).toBeNull()
  })

  /**
   * Live-validation regression: a same-model projection is a mathematical
   * no-op, but `projectCost` sums per-tier terms in one pass while the
   * upstream actual cost it is compared against was accumulated one response
   * at a time — floating-point addition is not associative, so the two
   * totals can disagree by a sub-cent residue that lands on either side of
   * zero depending on the token mix. On real data this residue happened to
   * be negative for Sonnet 5 (rendering `-$0.00 (-0.0%)`, a false loss) and
   * positive for Fable 5 / Opus 5 (rendering `+$0.00`). Both are the same
   * no-op and must render identically, with no sign at all.
   */
  it('treats a negative floating-point residue below display precision as a no-op, not a loss', () => {
    const negativeResidue = -1.4210854715202004e-14
    expect(formatWhatIfDelta(negativeResidue, negativeResidue)).toBeNull()
  })

  it('treats a positive floating-point residue below display precision as the same no-op', () => {
    const positiveResidue = 2.842170943040401e-14
    expect(formatWhatIfDelta(positiveResidue, positiveResidue)).toBeNull()
  })

  /**
   * The same residue, reached through `projectCost` itself rather than a
   * hand-picked epsilon — `sourceRow.totalCost` stands in for a total the
   * main process accumulated per-response, so it disagrees with the
   * single-shot `projectedTotal` in the last few bits of the double even
   * though both describe the exact same $2.00 (1,000,000 tokens @ Sonnet 5's
   * $2/MTok input rate, everything else zero).
   */
  it('is a no-op end to end for a same-model projection carrying float noise from projectCost', () => {
    const row: ModelEfficiencyRow = {
      id: 'sonnet-5',
      model: 'sonnet-5',
      turnCount: 1,
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheCreationUnknownTtlTokens: 0,
      totalOutputTokens: 0,
      avgOutputPerTurn: 0,
      totalCost: 2 + Number.EPSILON * 4,
      costPerTurn: 2 + Number.EPSILON * 4,
      percentOfTotalCost: 100,
    }

    const result = projectCost(row, 'sonnet-5', 'sonnet-5', ANTHROPIC_PRICING)
    expect(result).not.toBeNull()
    expect(result!.deltaCost).toBeLessThan(0)
    expect(result!.deltaCost).not.toBe(0)
    expect(formatWhatIfDelta(result!.deltaCost, result!.deltaPct)).toBeNull()
  })
})
