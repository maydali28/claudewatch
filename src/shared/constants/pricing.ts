import type { ModelPricing, ModelFamily, PricingProvider } from '@shared/types/pricing'
import type { AppPreferences } from '@shared/types/preferences'

// ─── Anthropic API Pricing (per million tokens) ───────────────────────────────
// Source: platform.claude.com/docs/en/about-claude/pricing
//
// Cache 5m write = 1.25x base input. Cache 1h write = 2x base input.
// Cache read = 0.1x base input, EXCEPT Fable 5.1 / Mythos 5.1 (0.025x, a flat
// $0.25 per million) and Opus 5.5 (0.05x, $0.20 per million).
//
// Confirmed by the published pricing table (platform.claude.com/docs/en/
// about-claude/pricing), not carried over as an assumption:
//   - The 1.25x / 2x write multipliers hold for Fable 5.1 and Mythos 5.1,
//     same as every other model here.
//   - Mythos 5.1 shares Fable 5.1's flat $0.25 cache read rate.
//   - Opus 5.5 is $4 / $20 with cache reads at 0.05x ($0.20), and the usual
//     1.25x / 2x write multipliers ($5 / $8).

/**
 * Bump whenever any rate below changes, or whenever `getModelFamily` starts
 * resolving an ID differently. Persisted alongside every cached cost so stale
 * figures are recomputed rather than served from disk — without this, a rate
 * correction reaches only sessions whose transcript happens to change
 * afterwards, leaving totals that mix old and new pricing.
 *
 * 2 — added fable-5-1 / mythos-5-1 / opus-5 / sonnet-5 / sonnet-3-5, corrected
 *     the Fable 5.1 cache-read rate, and stopped pricing unknown models.
 * 3 — added opus-5-5, so sessions cached as `unknown` before it was
 *     recognised are repriced instead of staying unpriced; dropped opus-3 /
 *     sonnet-3-7 / sonnet-3-5 / haiku-3, which no longer appear on the
 *     official pricing page, so their sessions now surface as unpriced.
 */
export const PRICING_REVISION = 3

export const ANTHROPIC_PRICING: Record<ModelFamily, ModelPricing> = {
  // ── Fable 5.1 / Mythos 5.1 — $10 input / $50 output, $0.25 cache read ────
  'fable-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25, cache5m: 12.5, cache1h: 20.0 },
  'mythos-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25, cache5m: 12.5, cache1h: 20.0 },

  // ── Fable 5 / Mythos 5 — $10 input / $50 output ──────────────────────────
  'fable-5': { input: 10.0, output: 50.0, cacheRead: 1.0, cache5m: 12.5, cache1h: 20.0 },
  'mythos-5': { input: 10.0, output: 50.0, cacheRead: 1.0, cache5m: 12.5, cache1h: 20.0 },

  // ── Opus 5.5 — $4 input / $20 output, $0.20 cache read (0.05x) ───────────
  'opus-5-5': { input: 4.0, output: 20.0, cacheRead: 0.2, cache5m: 5.0, cache1h: 8.0 },

  // ── Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 — $5 input / $25 output ───────────────
  'opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-8': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-7': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-6': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },

  // ── Opus 4.1 / 4 — $15 input / $75 output ────────────────────────────────
  'opus-4-1': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },
  'opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },

  // ── Sonnet 5 — $2 input / $10 output ─────────────────────────────────────
  'sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2, cache5m: 2.5, cache1h: 4.0 },

  // ── Sonnet 4.6 / 4.5 / 4 — $3 input / $15 output ─────────────────────────
  'sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4-5': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },

  // ── Haiku 4.5 — $1 input / $5 output ─────────────────────────────────────
  'haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1, cache5m: 1.25, cache1h: 2.0 },

  // ── Haiku 3.5 — $0.80 input / $4 output ──────────────────────────────────
  'haiku-3-5': { input: 0.8, output: 4.0, cacheRead: 0.08, cache5m: 1.0, cache1h: 1.6 },

  // ── Unknown — deliberately zero; `estimateCost` refuses to price it ──────
  // Never give this a plausible fallback rate. A guessed rate is indis-
  // tinguishable from a real one in the UI, which is how Opus 5 usage was
  // reported at Sonnet rates without anything appearing wrong.
  unknown: { input: 0, output: 0, cacheRead: 0, cache5m: 0, cache1h: 0 },
}

// ─── Lookup function ──────────────────────────────────────────────────────────

export function getPricingTable(provider: PricingProvider): Record<ModelFamily, ModelPricing> {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_PRICING
  }
}

// ─── getActivePricingTable ────────────────────────────────────────────────────
//
// Returns the base pricing table for the user's chosen provider/region, then
// applies any per-model overrides configured in preferences.
//
// Lives here (not main-only) so both the main-process pricing engine and
// renderer components that read `prefs` from the settings store — e.g. the
// what-if calculator and the compaction cost panel — reprice at the same
// effective rates the rest of the app uses, instead of a component quietly
// falling back to the built-in table and disagreeing with an active override.
export function getActivePricingTable(prefs: AppPreferences): Record<ModelFamily, ModelPricing> {
  const base = getPricingTable(prefs.pricingProvider)

  // Shallow-clone so we don't mutate the shared constant
  const table: Record<ModelFamily, ModelPricing> = { ...base }

  // Apply overrides
  for (const [family, overrides] of Object.entries(prefs.pricingOverrides) as [
    ModelFamily,
    Partial<ModelPricing>,
  ][]) {
    if (overrides && Object.keys(overrides).length > 0) {
      table[family] = { ...table[family], ...overrides }
    }
  }

  return table
}

// ─── Cost Calculation ─────────────────────────────────────────────────────────

/**
 * Cost in USD for one response's token usage, or `null` when the model is not
 * recognised and therefore cannot be priced. Callers must propagate the `null`
 * as an explicit "unpriced" state rather than coercing it to zero in a total
 * that is presented as complete.
 */
export function estimateCost(
  family: ModelFamily,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cache5mTokens: number,
  cache1hTokens: number,
  table: Record<ModelFamily, ModelPricing>
): number | null {
  if (family === 'unknown') return null
  const p = table[family]
  if (!p) return null
  return (
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cache5mTokens / 1_000_000) * p.cache5m +
    (cache1hTokens / 1_000_000) * p.cache1h
  )
}
