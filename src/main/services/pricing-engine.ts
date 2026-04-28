import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import type { AppPreferences } from '@shared/types/preferences'
import {
  getPricingTable as sharedGetPricingTable,
  estimateCost as sharedEstimateCost,
} from '@shared/constants/pricing'
import { getModelFamily } from '@shared/constants/models'

// ─── Re-export shared helpers so callers only need one import ────────────────

export { sharedEstimateCost as estimateCost, getModelFamily }

// ─── getActivePricingTable ────────────────────────────────────────────────────
//
// Returns the base pricing table for the user's chosen provider/region, then
// applies any per-model overrides configured in preferences.

export function getActivePricingTable(prefs: AppPreferences): Record<ModelFamily, ModelPricing> {
  const base = sharedGetPricingTable(prefs.pricingProvider, prefs.pricingRegion)

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
