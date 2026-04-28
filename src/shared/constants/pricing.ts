import type {
  ModelPricing,
  ModelFamily,
  PricingProvider,
  VertexRegion,
} from '@shared/types/pricing'

// ─── Anthropic API Pricing (per million tokens) ───────────────────────────────
// Source: platform.claude.com/docs/en/about-claude/pricing
// Cache 5m write = 1.25x base input. Cache 1h write = 2x base input. Cache read = 0.1x base input.

export const ANTHROPIC_PRICING: Record<ModelFamily, ModelPricing> = {
  // ── Opus 4.7 / 4.6 / 4.5 — $5 input / $25 output ────────────────────────
  'opus-4-7': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-6': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },
  'opus-4-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cache5m: 6.25, cache1h: 10.0 },

  // ── Opus 4.1 / 4 / 3 — $15 input / $75 output ────────────────────────────
  'opus-4-1': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },
  'opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },
  'opus-3': { input: 15.0, output: 75.0, cacheRead: 1.5, cache5m: 18.75, cache1h: 30.0 },

  // ── Sonnet 4.6 / 4.5 / 4 / 3.7 — $3 input / $15 output ──────────────────
  'sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4-5': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-3-7': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },

  // ── Haiku 4.5 — $1 input / $5 output ─────────────────────────────────────
  'haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1, cache5m: 1.25, cache1h: 2.0 },

  // ── Haiku 3.5 — $0.80 input / $4 output ──────────────────────────────────
  'haiku-3-5': { input: 0.8, output: 4.0, cacheRead: 0.08, cache5m: 1.0, cache1h: 1.6 },

  // ── Haiku 3 — $0.25 input / $1.25 output ─────────────────────────────────
  'haiku-3': { input: 0.25, output: 1.25, cacheRead: 0.03, cache5m: 0.3, cache1h: 0.5 },

  // ── Fallback — Sonnet rates ───────────────────────────────────────────────
  unknown: { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
}

// Vertex global uses the same rates as Anthropic direct
export const VERTEX_GLOBAL_PRICING = ANTHROPIC_PRICING

// Vertex regional applies a 10% surcharge on all token tiers
const REGIONAL_SURCHARGE = 1.1

export const VERTEX_REGIONAL_PRICING: Record<ModelFamily, ModelPricing> = Object.fromEntries(
  (Object.entries(ANTHROPIC_PRICING) as [ModelFamily, ModelPricing][]).map(([family, p]) => [
    family,
    {
      input: p.input * REGIONAL_SURCHARGE,
      output: p.output * REGIONAL_SURCHARGE,
      cacheRead: p.cacheRead * REGIONAL_SURCHARGE,
      cache5m: p.cache5m * REGIONAL_SURCHARGE,
      cache1h: p.cache1h * REGIONAL_SURCHARGE,
    },
  ])
) as Record<ModelFamily, ModelPricing>

// ─── Lookup function ──────────────────────────────────────────────────────────

export function getPricingTable(
  provider: PricingProvider,
  _region?: VertexRegion
): Record<ModelFamily, ModelPricing> {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_PRICING
    case 'vertex-global':
      return VERTEX_GLOBAL_PRICING
    case 'vertex-regional':
      return VERTEX_REGIONAL_PRICING
  }
}

// ─── Cost Calculation ─────────────────────────────────────────────────────────

export function estimateCost(
  family: ModelFamily,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cache5mTokens: number,
  cache1hTokens: number,
  table: Record<ModelFamily, ModelPricing>
): number {
  const p = table[family] ?? table.unknown
  return (
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cache5mTokens / 1_000_000) * p.cache5m +
    (cache1hTokens / 1_000_000) * p.cache1h
  )
}
