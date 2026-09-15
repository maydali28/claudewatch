import React from 'react'
import { formatCost } from '@shared/utils'
import { ANTHROPIC_PRICING, getActivePricingTable } from '@shared/constants/pricing'
import { getModelMeta } from '@renderer/lib/model-meta'
import { useSettingsStore } from '@renderer/store/settings.store'
import type { ModelFamily, ModelPricing } from '@shared/types'
import type { ModelEfficiencyRow } from '@shared/types'

// Derived, never hand-maintained: a literal list silently omits every newly
// added family, which is how this calculator came to exclude the models
// accounting for most real usage.
const MODEL_OPTIONS: ModelFamily[] = (Object.keys(ANTHROPIC_PRICING) as ModelFamily[]).filter(
  (family) => family !== 'unknown'
)

interface Props {
  data: ModelEfficiencyRow[]
}

/**
 * Reprice the observed token workload at the target model's rates.
 *
 * Scaling total spend by (input + output) rates missed cache reads entirely,
 * so Fable 5 to 5.1 predicted no change despite a fourfold difference in the
 * read rate. This assumes the same token counts and cache pattern on the
 * target model; it does not predict behavioural differences.
 *
 * `pricingTable` is the caller's ACTIVE table (built-in rates plus any user
 * override), not the built-in constant — so a same-model projection stays a
 * no-op under an override too, instead of comparing an overridden actual cost
 * against a built-in-rate projection.
 *
 * Unsplit cache-write tokens (no TTL reported) are priced at the 5-minute
 * rate, the same fallback the cache tier display uses elsewhere — an
 * estimate, not a known TTL. Dropping this remainder entirely understated a
 * same-model projection: 1M unsplit writes on Sonnet 5 cost $2.50 actual but
 * projected to $0.00, a false 100% saving.
 */
export function projectCost(
  sourceRow: ModelEfficiencyRow,
  sourceModel: string,
  targetModel: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): { projectedTotal: number; deltaCost: number; deltaPct: number } | null {
  if (sourceRow.totalCost === 0 || sourceRow.turnCount === 0) return null
  // Same guard the aggregate cache-premium loops use in analytics-engine.ts:
  // 'unknown' is excluded explicitly, not merely by an absent table entry —
  // it DOES have an entry (all zeros), so checking presence alone would let
  // it silently price as a free model instead of refusing to project.
  if (sourceModel === 'unknown' || targetModel === 'unknown') return null
  const src = pricingTable[sourceModel as ModelFamily]
  const tgt = pricingTable[targetModel as ModelFamily]
  if (!src || !tgt) return null

  const projectedTotal =
    (sourceRow.inputTokens / 1_000_000) * tgt.input +
    (sourceRow.totalOutputTokens / 1_000_000) * tgt.output +
    (sourceRow.cacheReadTokens / 1_000_000) * tgt.cacheRead +
    (sourceRow.cacheCreation5mTokens / 1_000_000) * tgt.cache5m +
    (sourceRow.cacheCreation1hTokens / 1_000_000) * tgt.cache1h +
    (sourceRow.cacheCreationUnknownTtlTokens / 1_000_000) * tgt.cache5m

  const deltaCost = projectedTotal - sourceRow.totalCost
  return { projectedTotal, deltaCost, deltaPct: (deltaCost / sourceRow.totalCost) * 100 }
}

/**
 * Format the what-if delta for display, or `null` for a no-op that should
 * render as a plain dash.
 *
 * A same-model (or same-rate) projection should be an exact tie, but
 * `projectedTotal` above sums per-tier terms in one pass while
 * `sourceRow.totalCost` was accumulated upstream one response at a time —
 * floating-point addition is not associative, so the two totals can disagree
 * by a residue near the last bit of the double, landing on either side of
 * zero depending on the token mix. That residue is invisible at the cent/
 * tenth-of-a-percent precision this UI actually displays, but its raw sign
 * used to reach the template literal anyway: a same-model projection on
 * Sonnet 5 rendered `-$0.00 (-0.0%)` — a false loss — while the identical
 * no-op on Fable 5 and Opus 5 happened to round positive and rendered
 * `+$0.00`. Anything that rounds to zero at display precision is the same
 * no-op regardless of which way the underlying noise leans, so it always
 * renders as a dash rather than carrying a sign that isn't really there.
 */
export function formatWhatIfDelta(deltaCost: number, deltaPct: number): string | null {
  if (Math.round(deltaCost * 100) === 0) return null
  return `${deltaCost > 0 ? '+' : ''}${formatCost(deltaCost)} (${deltaPct.toFixed(1)}%)`
}

export function WhatIfCalculator({ data }: Props): React.JSX.Element {
  const availableModels = data
    .map((r) => r.model)
    .filter((m) => MODEL_OPTIONS.includes(m as ModelFamily))

  const [sourceModel, setSourceModel] = React.useState<string>(availableModels[0] ?? 'sonnet-4-6')
  const [targetModel, setTargetModel] = React.useState<string>('haiku-4-5')

  const sourceRow = data.find((r) => r.model === sourceModel)

  // The user's active rates (built-in table plus any override), not the raw
  // constant — otherwise a rate override moved the actual side of the
  // comparison (sourceRow.totalCost, priced by the main process from the
  // active table) without moving the projected side, making even a
  // same-model projection show a false delta.
  const { prefs } = useSettingsStore()
  const pricingTable = React.useMemo(() => getActivePricingTable(prefs), [prefs])

  const result = React.useMemo(
    () => (sourceRow ? projectCost(sourceRow, sourceModel, targetModel, pricingTable) : null),
    [sourceRow, sourceModel, targetModel, pricingTable]
  )

  const srcLabel = getModelMeta(sourceModel).label
  const tgtLabel = getModelMeta(targetModel).label

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Estimate cost if sessions of one model were run on another. Projection reprices the actual
        input, output, and cache token workload — including unsplit cache writes with no TTL
        reported, estimated at the 5-minute rate — at the target model&apos;s configured rates,
        assuming an identical workload and cache pattern. It does not predict behavioural
        differences (a cheaper model may need more turns).
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="whatif-source-model"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Source model
          </label>
          <select
            id="whatif-source-model"
            value={sourceModel}
            onChange={(e) => setSourceModel(e.target.value)}
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {getModelMeta(m).label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="whatif-target-model"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Target model
          </label>
          <select
            id="whatif-target-model"
            value={targetModel}
            onChange={(e) => setTargetModel(e.target.value)}
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {getModelMeta(m).label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {sourceRow && result ? (
        <div className="rounded-md bg-muted p-3 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Actual cost ({srcLabel})</span>
            <span className="font-medium">{formatCost(sourceRow.totalCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Projected cost ({tgtLabel})</span>
            <span className="font-medium">{formatCost(result.projectedTotal)}</span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="font-medium">Delta</span>
            {/* `deltaText === null` covers both a true tie and a sub-cent
                floating-point residue (see formatWhatIfDelta) — both must be
                colored as a no-op, not colored by the raw (possibly noisy)
                sign of `deltaCost`. */}
            {(() => {
              const deltaText = formatWhatIfDelta(result.deltaCost, result.deltaPct)
              return (
                <span
                  className={
                    deltaText === null
                      ? 'font-medium text-muted-foreground'
                      : result.deltaCost < 0
                        ? 'font-bold text-green-600'
                        : 'font-bold text-red-500'
                  }
                >
                  {deltaText ?? '—'}
                </span>
              )
            })()}
          </div>
          <p className="text-muted-foreground">
            Based on {sourceRow.turnCount.toLocaleString()} turns ·{' '}
            {formatCost(sourceRow.costPerTurn)} actual cost/turn
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {sourceRow
            ? 'No cost data for selected source model in this period.'
            : 'Source model has no recorded turns in this period.'}
        </p>
      )}
    </div>
  )
}
