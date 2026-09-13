import type { ModelPricing, ModelFamily, PricingProvider } from '@shared/types/pricing'

// ─── Anthropic API Pricing (per million tokens) ───────────────────────────────
// Source: platform.claude.com/docs/en/about-claude/pricing
//
// Cache 5m write = 1.25x base input. Cache 1h write = 2x base input.
// Cache read = 0.1x base input, EXCEPT Fable 5.1, which Anthropic prices at a
// flat $0.25 per million regardless of the input rate.
//
// Assumptions, both narrower than the published rates:
//   - The 1.25x / 2x write multipliers are taken to hold for Fable 5.1 and
//     Mythos 5.1; only the cache-read exception is published.
//   - Mythos 5.1 is assumed to share Fable 5.1's $0.25 cache read. The
//     published exception names Fable 5.1; whether Mythos 5.1 matches it is
//     open. Revisit when documented.

/**
 * Bump whenever any rate below changes, or whenever `getModelFamily` starts
 * resolving an ID differently. Persisted alongside every cached cost so stale
 * figures are recomputed rather than served from disk — without this, a rate
 * correction reaches only sessions whose transcript happens to change
 * afterwards, leaving totals that mix old and new pricing.
 *
 * 2 — added fable-5-1 / mythos-5-1 / opus-5 / sonnet-5 / sonnet-3-5, corrected
 *     the Fable 5.1 cache-read rate, and stopped pricing unknown models.
 */
export const PRICING_REVISION = 2

export const ANTHROPIC_PRICING: Record<ModelFamily, ModelPricing> = {
  // ── Fable 5.1 / Mythos 5.1 — $10 input / $50 output, $0.25 cache read ────
  'fable-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25, cache5m: 12.5, cache1h: 20.0 },
  'mythos-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25, cache5m: 12.5, cache1h: 20.0 },

  // ── Fable 5 / Mythos 5 — $10 input / $50 output ──────────────────────────
  'fable-5': { input: 10.0, output: 50.0, cacheRead: 1.0, cache5m: 12.5, cache1h: 20.0 },
  'mythos-5': { input: 10.0, output: 50.0, cacheRead: 1.0, cache5m: 12.5, cache1h: 20.0 },

  // ── Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 — $5 input / $25 output ───────────────
  'opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-8': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-7': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-6': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },

  // ── Opus 4.1 / 4 / 3 — $15 input / $75 output ────────────────────────────
  'opus-4-1': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },
  'opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },
  'opus-3': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },

  // ── Sonnet 5 — $2 input / $10 output ─────────────────────────────────────
  'sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2, cache5m: 2.5, cache1h: 4.0 },

  // ── Sonnet 4.6 / 4.5 / 4 / 3.7 / 3.5 — $3 input / $15 output ─────────────
  'sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4-5': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-3-7': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-3-5': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },

  // ── Haiku 4.5 — $1 input / $5 output ─────────────────────────────────────
  'haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1, cache5m: 1.25, cache1h: 2.0 },

  // ── Haiku 3.5 — $0.80 input / $4 output ──────────────────────────────────
  'haiku-3-5': { input: 0.8, output: 4.0, cacheRead: 0.08, cache5m: 1.0, cache1h: 1.6 },

  // ── Haiku 3 — $0.25 input / $1.25 output ─────────────────────────────────
  'haiku-3': { input: 0.25, output: 1.25, cacheRead: 0.03, cache5m: 0.3, cache1h: 0.5 },

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
