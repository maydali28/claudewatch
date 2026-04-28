import React from 'react'
import { formatCost } from '@shared/utils'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { getModelMeta } from '@renderer/lib/model-meta'
import type { ModelFamily } from '@shared/types'
import type { ModelEfficiencyRow } from '@shared/types'

const MODEL_OPTIONS: ModelFamily[] = [
  'opus-4-7',
  'opus-4-6',
  'opus-4-5',
  'opus-4-1',
  'opus-4',
  'opus-3',
  'sonnet-4-6',
  'sonnet-4-5',
  'sonnet-4',
  'sonnet-3-7',
  'haiku-4-5',
  'haiku-3-5',
  'haiku-3',
]

interface Props {
  data: ModelEfficiencyRow[]
}

// Project cost by scaling the actual cost-per-turn using the ratio of
// (target input+output rate) / (source input+output rate).
// This guarantees that selecting the same model yields exactly 0 delta.
function projectCost(
  sourceRow: ModelEfficiencyRow,
  sourceModel: string,
  targetModel: string
): { projectedTotal: number; deltaCost: number; deltaPct: number } | null {
  if (sourceRow.totalCost === 0 || sourceRow.turnCount === 0) return null

  const srcPricing = ANTHROPIC_PRICING[sourceModel as ModelFamily]
  const tgtPricing = ANTHROPIC_PRICING[targetModel as ModelFamily]
  if (!srcPricing || !tgtPricing) return null

  const srcRate = srcPricing.input + srcPricing.output
  const tgtRate = tgtPricing.input + tgtPricing.output
  if (srcRate === 0) return null

  const scale = tgtRate / srcRate
  const projectedTotal = sourceRow.totalCost * scale
  const deltaCost = projectedTotal - sourceRow.totalCost
  const deltaPct = (deltaCost / sourceRow.totalCost) * 100

  return { projectedTotal, deltaCost, deltaPct }
}

export function WhatIfCalculator({ data }: Props): React.JSX.Element {
  const availableModels = data
    .map((r) => r.model)
    .filter((m) => MODEL_OPTIONS.includes(m as ModelFamily))

  const [sourceModel, setSourceModel] = React.useState<string>(availableModels[0] ?? 'sonnet-4-6')
  const [targetModel, setTargetModel] = React.useState<string>('haiku-4-5')

  const sourceRow = data.find((r) => r.model === sourceModel)

  const result = React.useMemo(
    () => (sourceRow ? projectCost(sourceRow, sourceModel, targetModel) : null),
    [sourceRow, sourceModel, targetModel]
  )

  const srcLabel = getModelMeta(sourceModel).label
  const tgtLabel = getModelMeta(targetModel).label

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Estimate cost if sessions of one model were run on another. Projection scales actual spend
        by the ratio of input+output rates between models.
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
            <span
              className={
                result.deltaCost < 0
                  ? 'font-bold text-green-600'
                  : result.deltaCost > 0
                    ? 'font-bold text-red-500'
                    : 'font-medium text-muted-foreground'
              }
            >
              {result.deltaCost === 0
                ? '—'
                : `${result.deltaCost > 0 ? '+' : ''}${formatCost(result.deltaCost)} (${result.deltaPct.toFixed(1)}%)`}
            </span>
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
