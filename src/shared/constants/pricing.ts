import type {
  ModelPricing,
  ModelFamily,
  ModelRate,
  PricingProvider,
  PricingTable,
} from '@shared/types/pricing'
import type { AppPreferences } from '@shared/types/preferences'
import { getModelFamily } from '@shared/constants/models'

// ─── Anthropic API Pricing (per million tokens) ───────────────────────────────
// Source: platform.claude.com/docs/en/about-claude/pricing
//
// Cache 5m write = 1.25x base input. Cache 1h write = 2x base input.
// Cache read = 0.1x base input, EXCEPT Fable 5.1 / Mythos 5.1 (0.025x, a flat
// $0.25 per million) and Opus 5.5 / Sonnet 5.5 (0.05x: $0.20 and $0.10 per
// million).
//
// Confirmed by the published pricing table (platform.claude.com/docs/en/
// about-claude/pricing), not carried over as an assumption:
//   - The 1.25x / 2x write multipliers hold for Fable 5.1 and Mythos 5.1,
//     same as every other model here.
//   - Mythos 5.1 shares Fable 5.1's flat $0.25 cache read rate.
//   - Opus 5.5 is $4 / $20 with cache reads at 0.05x ($0.20), and the usual
//     1.25x / 2x write multipliers ($5 / $8).
//   - Sonnet 5.5 is $2 / $10 with cache reads at 0.05x ($0.10), not the 0.1x
//     ($0.20) Sonnet 5 has.
//   - Haiku 5.5 is the one model priced by prompt length: $0.10 / $0.50
//     ($0.125 / $0.20 writes, $0.01 reads) for a prompt of up to 100,000
//     tokens, and $0.50 / $2.50 ($0.625 / $1 writes, $0.05 reads) over that.
//     A prompt counts every input token, cache reads and writes included,
//     and each request is priced on its own (see `estimateCost`).

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
 * 4 — added sonnet-5-5, so sessions cached as `unknown` before it was
 *     recognised are repriced instead of staying unpriced.
 * 5 — corrected the Sonnet 5.5 cache-read rate from $0.20 to the published
 *     $0.10.
 * 6 — added haiku-5-5 and its long-prompt rates, so sessions cached as
 *     `unknown` before it was recognised are repriced instead of staying
 *     unpriced.
 */
export const PRICING_REVISION = 6

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

  // ── Sonnet 5.5 — $2 input / $10 output, $0.10 cache read (0.05x) ─────────
  'sonnet-5-5': { input: 2.0, output: 10.0, cacheRead: 0.1, cache5m: 2.5, cache1h: 4.0 },

  // ── Sonnet 5 — $2 input / $10 output ─────────────────────────────────────
  'sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2, cache5m: 2.5, cache1h: 4.0 },

  // ── Sonnet 4.6 / 4.5 / 4 — $3 input / $15 output ─────────────────────────
  'sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4-5': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },
  'sonnet-4': { input: 3.0, output: 15.0, cacheRead: 0.3, cache5m: 3.75, cache1h: 6.0 },

  // ── Haiku 5.5 — $0.10 input / $0.50 output; 5x for prompts over 100K ─────
  'haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cache5m: 0.125,
    cache1h: 0.2,
    longContext: {
      above: 100_000,
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cache5m: 0.625,
      cache1h: 1.0,
    },
  },

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

/** Every family with real rates, in table order: the choices for mapping a model. */
export const PRICED_FAMILIES = (Object.keys(ANTHROPIC_PRICING) as ModelFamily[]).filter(
  (f) => f !== 'unknown'
) as Exclude<ModelFamily, 'unknown'>[]

export function isPricedFamily(
  family: string | undefined
): family is Exclude<ModelFamily, 'unknown'> {
  return !!family && (PRICED_FAMILIES as string[]).includes(family)
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
export function getActivePricingTable(
  prefs: Pick<AppPreferences, 'pricingProvider' | 'pricingOverrides'> &
    Partial<Pick<AppPreferences, 'modelPreferences'>>
): PricingTable {
  const base = getPricingTable(prefs.pricingProvider)

  // Shallow-clone so we don't mutate the shared constant
  const table: PricingTable = { ...base }

  // Apply overrides
  for (const [family, overrides] of Object.entries(prefs.pricingOverrides) as [
    ModelFamily,
    Partial<ModelPricing>,
  ][]) {
    if (overrides && Object.keys(overrides).length > 0) {
      // Rates the user entered are used as entered, at any prompt length:
      // the built-in long-prompt tier was priced against the built-in base
      // rates, not theirs.
      table[family] = { ...table[family], ...overrides, longContext: undefined }
    }
  }

  // Then each model ID the user mapped or priced. A model's own rates sit on
  // top of its family's (after the family overrides above); a model with no
  // known family is priced only when its own rates are complete, since a
  // guessed rate is indistinguishable from a real one.
  for (const [model, pref] of Object.entries(prefs.modelPreferences ?? {})) {
    const own = definedRates(pref.rates)
    // A family name this build does not know (a stale or hand-edited
    // preference) is ignored rather than trusted.
    const mapped = isPricedFamily(pref.family) ? pref.family : undefined
    if (!mapped && Object.keys(own).length === 0) continue
    const family = mapped ?? getModelFamily(model)
    const rates: Partial<ModelPricing> = { ...(family === 'unknown' ? {} : table[family]), ...own }
    // Same rule as the family overrides above: a model the user priced
    // themselves pays their rates at any prompt length.
    if (Object.keys(own).length > 0) delete rates.longContext
    if (!isCompleteRates(rates)) continue
    table[`model:${model}`] = { family, ...rates }
  }

  return table
}

const RATE_KEYS = ['input', 'output', 'cacheRead', 'cache5m', 'cache1h'] as const

function definedRates(rates: Partial<ModelPricing> | undefined): Partial<ModelPricing> {
  const out: Partial<ModelPricing> = {}
  for (const k of RATE_KEYS) {
    const v = rates?.[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
  }
  return out
}

function isCompleteRates(rates: Partial<ModelPricing>): rates is ModelPricing {
  return RATE_KEYS.every((k) => typeof rates[k] === 'number')
}

/** The user's own entry for one exact model ID, if they mapped or priced it. */
export function modelRate(
  table: Record<ModelFamily, ModelPricing>,
  model: string | null | undefined
): ModelRate | undefined {
  if (!model) return undefined
  return (table as PricingTable)[`model:${model}`]
}

/** The family a model counts as: the user's mapping first, then the built-in one. */
export function resolveModelFamily(
  model: string | null | undefined,
  table: Record<ModelFamily, ModelPricing>
): ModelFamily {
  return modelRate(table, model)?.family ?? getModelFamily(model)
}

/**
 * The rates one response is priced at: the model ID's own entry when the user
 * set one, else its family's. Undefined means it cannot be priced.
 */
export function ratesFor(
  table: Record<ModelFamily, ModelPricing>,
  family: ModelFamily,
  model?: string | null
): ModelPricing | undefined {
  const own = modelRate(table, model)
  if (own) return own
  if (family === 'unknown') return undefined
  return table[family]
}

// ─── Cost Calculation ─────────────────────────────────────────────────────────

/**
 * Cost in USD for one response's token usage, or `null` when the model is not
 * recognised and therefore cannot be priced. A model with long-prompt rates
 * (`ModelPricing.longContext`) is priced at them when this response's prompt
 * (every input token, cache reads and writes included) is past the threshold. Callers must propagate the `null`
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
  table: Record<ModelFamily, ModelPricing>,
  model?: string | null
): number | null {
  const base = ratesFor(table, family, model)
  if (!base) return null
  const prompt = inputTokens + cacheReadTokens + cache5mTokens + cache1hTokens
  const p = base.longContext && prompt > base.longContext.above ? base.longContext : base
  return (
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cache5mTokens / 1_000_000) * p.cache5m +
    (cache1hTokens / 1_000_000) * p.cache1h
  )
}
