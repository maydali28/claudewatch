import type { ModelFamily } from '@shared/types/pricing'
import type { ResponseEntry } from './ledger'

/**
 * Derives everything the app displays from ledger entries.
 *
 * This is the only place tokens are added up. Each figure states its scope —
 * parent-only or parent-plus-subagents — because conflating the two is what
 * previously let a session's totals disagree with its own model breakdown.
 */

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheWriteTotal: number
  /** Sum of priced responses only. */
  estimatedCost: number
  /** Responses whose model could not be priced; their tokens are still counted. */
  unpricedResponses: number
  responseCount: number
}

export interface ModelUsageRow {
  /** Exact model string as written. */
  model: string
  family: ModelFamily
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5m: number
  cacheWrite1h: number
  /** Null when no response for this model could be priced. */
  estimatedCost: number | null
  turnCount: number
}

export interface DayBucket extends UsageTotals {
  day: string
  /** Families actually used on this day — not the session's lifetime models. */
  families: ModelFamily[]
  /** Per-model usage for this day, so model charts can be date-scoped. */
  models: ModelUsageRow[]
}

export interface UsageProjection {
  parent: UsageTotals
  combined: UsageTotals
  /** Combined scope, one row per exact model. */
  modelBreakdown: ModelUsageRow[]
  /** Most recent parent response's model — the live badge. */
  latestParentModel?: string
  /** Parent model with the most responses over the session's life. */
  dominantParentModel?: string
  /** Every model seen, parent and child. */
  modelsUsed: string[]
  byDay: DayBucket[]
  /** Responses whose repeated snapshots disagreed in a non-output field. */
  conflictCount: number
}

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheWriteTotal: 0,
    estimatedCost: 0,
    unpricedResponses: 0,
    responseCount: 0,
  }
}

function add(totals: UsageTotals, e: ResponseEntry): void {
  totals.inputTokens += e.inputTokens
  totals.outputTokens += e.outputTokens
  totals.cacheReadTokens += e.cacheReadTokens
  totals.cacheWrite5m += e.cacheWrite5m
  totals.cacheWrite1h += e.cacheWrite1h
  // The flat counter is authoritative for the total written; the tiers describe
  // how it splits. Summing the tiers instead would drop unsplit legacy writes.
  totals.cacheWriteTotal += e.cacheWriteFlat
  totals.responseCount++
  if (e.costUsd === null) totals.unpricedResponses++
  else totals.estimatedCost += e.costUsd
}

/** Fold one response into a model-keyed map, shared by the lifetime and per-day rollups. */
function accumulateModel(target: Map<string, ModelUsageRow>, e: ResponseEntry): void {
  const key = e.modelRaw ?? '(no model)'
  const row = target.get(key)
  if (row) {
    row.inputTokens += e.inputTokens
    row.outputTokens += e.outputTokens
    row.cacheReadTokens += e.cacheReadTokens
    row.cacheWrite5m += e.cacheWrite5m
    row.cacheWrite1h += e.cacheWrite1h
    row.turnCount++
    if (e.costUsd !== null) row.estimatedCost = (row.estimatedCost ?? 0) + e.costUsd
    return
  }
  target.set(key, {
    model: key,
    family: e.modelFamily,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    cacheReadTokens: e.cacheReadTokens,
    cacheWrite5m: e.cacheWrite5m,
    cacheWrite1h: e.cacheWrite1h,
    estimatedCost: e.costUsd,
    turnCount: 1,
  })
}

export function projectUsage(entries: ResponseEntry[]): UsageProjection {
  const parent = emptyTotals()
  const combined = emptyTotals()
  const byModel = new Map<string, ModelUsageRow>()
  const byDay = new Map<string, DayBucket>()
  const dayFamilies = new Map<string, Set<ModelFamily>>()
  const dayModels = new Map<string, Map<string, ModelUsageRow>>()
  const parentCounts = new Map<string, number>()

  let latestParentModel: string | undefined
  let latestParentTs = ''
  let conflictCount = 0

  for (const e of entries) {
    add(combined, e)
    if (e.usageConflict) conflictCount++

    if (e.kind === 'parent') {
      add(parent, e)
      if (e.modelRaw) {
        parentCounts.set(e.modelRaw, (parentCounts.get(e.modelRaw) ?? 0) + 1)
        // Strictly later wins, so a tie keeps the earlier-seen response and the
        // badge cannot flicker between two responses sharing a timestamp.
        if (e.tsUtc > latestParentTs) {
          latestParentTs = e.tsUtc
          latestParentModel = e.modelRaw
        }
      }
    }

    accumulateModel(byModel, e)

    let bucket = byDay.get(e.dayLocal)
    if (!bucket) {
      bucket = { day: e.dayLocal, families: [], models: [], ...emptyTotals() }
      byDay.set(e.dayLocal, bucket)
      dayFamilies.set(e.dayLocal, new Set())
      dayModels.set(e.dayLocal, new Map())
    }
    add(bucket, e)
    dayFamilies.get(e.dayLocal)!.add(e.modelFamily)
    accumulateModel(dayModels.get(e.dayLocal)!, e)
  }

  let dominantParentModel: string | undefined
  let mostResponses = 0
  for (const [model, count] of parentCounts) {
    if (count > mostResponses) {
      mostResponses = count
      dominantParentModel = model
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  for (const day of days) {
    day.families = [...(dayFamilies.get(day.day) ?? [])].sort()
    day.models = [...(dayModels.get(day.day)?.values() ?? [])].sort(
      (a, b) => b.turnCount - a.turnCount
    )
  }

  return {
    parent,
    combined,
    modelBreakdown: [...byModel.values()].sort((a, b) => b.turnCount - a.turnCount),
    latestParentModel,
    dominantParentModel,
    modelsUsed: [...byModel.keys()],
    byDay: days,
    conflictCount,
  }
}
