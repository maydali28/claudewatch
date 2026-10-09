import type { ModelFamily, ModelPricing, ModelRate } from '@shared/types/pricing'
import {
  estimateCost as sharedEstimateCost,
  getActivePricingTable as sharedGetActivePricingTable,
  ratesFor,
  resolveModelFamily,
} from '@shared/constants/pricing'
import { getModelFamily } from '@shared/constants/models'

// ─── Re-export shared helpers so callers only need one import ────────────────
//
// `getActivePricingTable` moved to `@shared/constants/pricing` so renderer
// components (which cannot import `@main`) can build the same override-aware
// table from the `prefs` they already read off the settings store. Re-exported
// here so every existing main-process caller keeps working unchanged.

export {
  sharedEstimateCost as estimateCost,
  getModelFamily,
  sharedGetActivePricingTable as getActivePricingTable,
  ratesFor,
  resolveModelFamily,
}

// ─── pricingFingerprint ───────────────────────────────────────────────────────

/**
 * Identity of the rates a summary was priced at.
 *
 * `PRICING_REVISION` only moves when the built-in table changes, so a user
 * override left every cached cost untouched: a fixture repriced from $0.0004
 * to $0.2002 on reparse while the cache kept serving $0.0004. This covers the
 * table actually in effect — built-in rates plus any override — so a cache
 * stamped with it goes stale the moment the *effective* rates do, regardless
 * of whether the change came from a new build or a user edit.
 *
 * `Object.entries` order follows insertion, which for a spread-merged table
 * depends on which families were overridden — sorting keeps the digest a
 * function of the rates alone, not of how the table was assembled.
 *
 * A `model:<id>` entry adds the family the user mapped that ID to, so a
 * mapping that leaves the rates unchanged still restamps: the family is
 * stored per response, and model breakdowns group by it.
 */
export function pricingFingerprint(table: Record<ModelFamily, ModelPricing>): string {
  return Object.entries(table)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, p]: [string, ModelPricing & Partial<Pick<ModelRate, 'family'>>]) => {
      const l = p.longContext
      const rates =
        `${p.input},${p.output},${p.cacheRead},${p.cache5m},${p.cache1h}` +
        (l ? `>${l.above}:${l.input},${l.output},${l.cacheRead},${l.cache5m},${l.cache1h}` : '')
      return p.family ? `${f}=${p.family}:${rates}` : `${f}:${rates}`
    })
    .join('|')
}
