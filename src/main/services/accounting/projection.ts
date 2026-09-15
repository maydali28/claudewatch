import type { ModelFamily } from '@shared/types/pricing'
import { parseInstant } from '@shared/utils/date-ranges'
import { cacheWriteUnknownTtl, effectiveCacheWriteTotal, type ResponseEntry } from './ledger'

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
  /**
   * The effective write volume — `cacheWriteFlat`, or the tier sum when the
   * tiers report MORE than the flat counter (see `effectiveCacheWriteTotal`
   * in `ledger.ts`). Never the raw flat counter alone: that undercounted a
   * response whose tiers exceeded it, showing 40 tokens here while the same
   * response was priced at 100.
   */
  cacheWriteTotal: number
  /**
   * The portion of `cacheWriteTotal` no TTL tier explains — see
   * `cacheWriteUnknownTtl` in `ledger.ts`. Zero whenever the tiers meet or
   * exceed the flat counter, since they then account for the whole total
   * themselves.
   */
  cacheWriteUnknownTtl: number
  /** Sum of priced responses only. */
  estimatedCost: number
  /** Responses whose model could not be priced; their tokens are still counted. */
  unpricedResponses: number
  /**
   * Responses whose usage shape the ledger cannot price with confidence — see
   * `ResponseEntry.usageIncomplete`. Their tokens and cost are still counted;
   * this is a tripwire for data that has never been observed, not a filter.
   */
  incompleteUsageResponses: number
  /**
   * Responses whose id fell back to `uuid:<record uuid>` because no record
   * carried a `message.id` — see `ResponseEntry.reducedConfidenceId`. Their
   * tokens and cost are still counted; this is a provenance count, not a
   * filter.
   */
  reducedConfidenceResponses: number
  /**
   * Responses where no snapshot ever reported a non-empty `stop_reason` — see
   * `ResponseEntry.hasCompletionSignal`. Unlike `incompleteUsageResponses`,
   * this is NOT a tripwire for data that never occurs: measured at 28% of
   * response groups in real history, so it deliberately stays out of
   * `usageIncomplete`, whose real-history value is asserted to be zero. A
   * completion signal means a stop reason was observed on SOME snapshot of this
   * response; the output count is the MAXIMUM observed across all snapshots;
   * when a later provisional snapshot exceeds a completed one, the flag and the
   * number describe different observations. The flag is provenance — where the
   * information came from — never a certification that the output figure is
   * final or correct.
   */
  responsesWithoutCompletionSignal: number
  responseCount: number
  /**
   * A SUBSET of `outputTokens` — the model's own reported thinking spend
   * within the output it already produced, never a quantity on top of it.
   * Summed independently of `outputTokens` in `add()` on purpose: folding it
   * in would double-count exactly the tokens it's carved from, the same
   * class of overcount this ledger exists to eliminate. Responses that don't
   * report it contribute 0, not an unknown — most transcripts predate the
   * field, and that is a legitimate "none", not a gap.
   */
  thinkingTokens: number
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
  /**
   * The remainder of the effective write total (see `cacheWriteUnknownTtl` in
   * `ledger.ts`) the tiers do not explain. The day total already falls back
   * to the flat counter when a write is unsplit (see `add()` below); this is
   * the model-row equivalent, so an unsplit write cannot vanish from the
   * breakdown while still counting toward the total. Zero whenever the tiers
   * meet or exceed the flat counter.
   */
  cacheWriteUnknownTtl: number
  /** Null when no response for this model could be priced. */
  estimatedCost: number | null
  turnCount: number
}

export interface DayBucket extends UsageTotals {
  day: string
  /** Cost from parent responses alone, excluding subagents. */
  parentEstimatedCost: number
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
  /**
   * How many responses (parent + subagent, deduplicated the same as
   * `entries()`) recorded each exact effort string. Keyed by whatever value
   * the transcript wrote — never coerced into the four-bucket scale.
   *
   * This is NOT the same signal as `SessionObservability.effortDistribution`
   * elsewhere in the app: that one is INFERRED per turn from output length
   * and thinking-block character count, a guess made when nothing better is
   * available. This one is RECORDED — read directly off `ResponseEntry.effortRecorded`,
   * which came from the transcript's own `effort` field. A reader tells them
   * apart by the name (`recordedEffortDistribution` vs. `effortDistribution`)
   * and by shape (`Record<string, number>` here vs. the fixed four-field
   * `EffortDistribution` there). Never merge the two or use one as a
   * fallback for the other — a session where they disagree is exactly the
   * case worth being able to see.
   */
  recordedEffortDistribution: Record<string, number>
  /** Distinct `service_tier` values reported, e.g. `standard` / `priority`. */
  serviceTiers: string[]
  /** Distinct `speed` values reported. */
  speeds: string[]
  /** Distinct `inference_geo` values reported. */
  inferenceGeos: string[]
}

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheWriteTotal: 0,
    cacheWriteUnknownTtl: 0,
    estimatedCost: 0,
    unpricedResponses: 0,
    incompleteUsageResponses: 0,
    reducedConfidenceResponses: 0,
    responsesWithoutCompletionSignal: 0,
    responseCount: 0,
    thinkingTokens: 0,
  }
}

function add(totals: UsageTotals, e: ResponseEntry): void {
  totals.inputTokens += e.inputTokens
  totals.outputTokens += e.outputTokens
  totals.cacheReadTokens += e.cacheReadTokens
  totals.cacheWrite5m += e.cacheWrite5m
  totals.cacheWrite1h += e.cacheWrite1h
  // The flat counter is normally authoritative for the total written, with
  // the tiers describing how it splits — summing the tiers alone would drop
  // an unsplit legacy write. But when the tiers report MORE than the flat
  // counter, they are the more specific measurement and win instead; adding
  // the raw flat counter unconditionally here reported 40 tokens for a
  // response the ledger priced at 100. `effectiveCacheWriteTotal` picks
  // whichever is larger, matching what `costUsd` above was already priced
  // from.
  totals.cacheWriteTotal += effectiveCacheWriteTotal(e)
  totals.cacheWriteUnknownTtl += cacheWriteUnknownTtl(e)
  totals.responseCount++
  if (e.costUsd === null) totals.unpricedResponses++
  else totals.estimatedCost += e.costUsd
  if (e.usageIncomplete) totals.incompleteUsageResponses++
  if (e.reducedConfidenceId) totals.reducedConfidenceResponses++
  if (!e.hasCompletionSignal) totals.responsesWithoutCompletionSignal++
  // Deliberately its own statement, not folded into `totals.outputTokens +=`
  // above: thinkingTokens is a subset of outputTokens, and adding it there
  // would double-count it. See `UsageTotals.thinkingTokens`.
  totals.thinkingTokens += e.thinkingTokens ?? 0
}

/** Fold one response into a model-keyed map, shared by the lifetime and per-day rollups. */
function accumulateModel(target: Map<string, ModelUsageRow>, e: ResponseEntry): void {
  const key = e.modelRaw ?? '(no model)'
  // The flat counter is normally authoritative; the tiers explain how it
  // splits, and any remainder has a real cost but an unknown TTL that must
  // not vanish from the per-model view — the day total had a fallback, the
  // model rows did not. Shared with the day total's `add()` above and with
  // `ledger.ts`'s pricing: when the tiers report more than the flat counter,
  // `cacheWriteUnknownTtl` is 0 rather than a negative remainder, because the
  // tiers already account for the whole effective total themselves.
  const unknownTtl = cacheWriteUnknownTtl(e)
  const row = target.get(key)
  if (row) {
    row.inputTokens += e.inputTokens
    row.outputTokens += e.outputTokens
    row.cacheReadTokens += e.cacheReadTokens
    row.cacheWrite5m += e.cacheWrite5m
    row.cacheWrite1h += e.cacheWrite1h
    row.cacheWriteUnknownTtl += unknownTtl
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
    cacheWriteUnknownTtl: unknownTtl,
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
  let latestParentInstant = -Infinity
  let conflictCount = 0
  const recordedEffortDistribution: Record<string, number> = {}
  const serviceTiers = new Set<string>()
  const speeds = new Set<string>()
  const inferenceGeos = new Set<string>()

  for (const e of entries) {
    add(combined, e)
    if (e.usageConflict) conflictCount++
    // One vote per response, the same as everything else in this loop —
    // `entries` is already deduplicated by the ledger, so no extra
    // dedup is needed here to keep this counted once per response.
    if (e.effortRecorded !== undefined) {
      recordedEffortDistribution[e.effortRecorded] =
        (recordedEffortDistribution[e.effortRecorded] ?? 0) + 1
    }
    if (e.serviceTier !== undefined) serviceTiers.add(e.serviceTier)
    if (e.speed !== undefined) speeds.add(e.speed)
    if (e.inferenceGeo !== undefined) inferenceGeos.add(e.inferenceGeo)

    if (e.kind === 'parent') {
      add(parent, e)
      if (e.modelRaw) {
        parentCounts.set(e.modelRaw, (parentCounts.get(e.modelRaw) ?? 0) + 1)
        // `parseInstant` compares parsed instants, not raw strings: a
        // `+02:00`-offset timestamp can sort later than a `Z` one while naming
        // an earlier instant, which picked the wrong model for this badge. It
        // also returns `null` rather than `NaN` for a malformed timestamp, so
        // an unparseable one is never evidence that a response is the latest
        // one and can neither dislodge a real instant nor stand in as the
        // first one. Strictly later wins, so a tie keeps the earlier-seen
        // response and the badge cannot flicker between two responses sharing
        // an instant.
        const parentInstant = e.tsUtc === undefined ? null : parseInstant(e.tsUtc)
        if (parentInstant !== null && parentInstant > latestParentInstant) {
          latestParentInstant = parentInstant
          latestParentModel = e.modelRaw
        }
      }
    }

    accumulateModel(byModel, e)

    let bucket = byDay.get(e.dayLocal)
    if (!bucket) {
      bucket = {
        day: e.dayLocal,
        families: [],
        models: [],
        parentEstimatedCost: 0,
        ...emptyTotals(),
      }
      byDay.set(e.dayLocal, bucket)
      dayFamilies.set(e.dayLocal, new Set())
      dayModels.set(e.dayLocal, new Map())
    }
    add(bucket, e)
    if (e.kind === 'parent' && e.costUsd !== null) bucket.parentEstimatedCost += e.costUsd
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
    recordedEffortDistribution,
    serviceTiers: [...serviceTiers].sort(),
    speeds: [...speeds].sort(),
    inferenceGeos: [...inferenceGeos].sort(),
  }
}
