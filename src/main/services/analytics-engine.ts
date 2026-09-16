import type { SessionSummary, EffortLevel } from '@shared/types/session'
import type { Project } from '@shared/types/project'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import type {
  AnalyticsData,
  DailyUsage,
  ProjectCost,
  ModelUsage,
  CacheAnalytics,
  CompactionAnalytics,
  SessionCompactionEntry,
  ModelEfficiencyRow,
  DailyModelCost,
  LatencyAnalytics,
  LatencyBucket,
  SlowTurnEntry,
  EffortAnalytics,
  EffortCostBreakdown,
  ParallelToolAnalytics,
  ParallelToolBucket,
  SessionCacheEfficiency,
  ModelCacheSavings,
  DailyHitRatio,
  DateRange,
  SessionHealthSummary,
  SessionHealthEntry,
  SessionPeriodRow,
} from '@shared/types/analytics'
import type { SessionDayUsage } from '@shared/types/session'
import type { LintCheckId, LintSeverity } from '@shared/types/lint'
import { getModelFamily } from '@shared/constants/models'

import {
  resolveDateRange,
  toDateKey,
  toDayKeyOrUndated,
  isWithinRange,
  UNDATED_DAY,
  zeroFillDailySeries,
  dateKeysInRange,
} from '@shared/utils/date-ranges'

// ─── Internal helpers ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

/**
 * Days a session was actually active within the range.
 *
 * Everything date-scoped derives from this. Filtering on `lastTimestamp`
 * attributed a session's whole history to its final day, so resuming
 * yesterday's session today moved yesterday's tokens — and yesterday's models
 * — into today, and selecting yesterday showed nothing at all.
 *
 * `includeUndated` admits `UNDATED_DAY` rows alongside the calendar-bounded
 * ones. It is passed down explicitly by every caller (ultimately from
 * `computeAnalytics`'s own `dateRange === 'all'` check) rather than inferred
 * here: `UNDATED_DAY` sorts lexically before every real `YYYY-MM-DD` key,
 * including `'1970-01-01'`, so `d.day >= fromKey` alone can never admit it —
 * by design, so every other caller of this same lexical comparison keeps
 * excluding undated activity from a bounded range without a special case.
 * The `all` preset is the one caller that wants it in, so it says so.
 */
function daysInRange(
  session: SessionSummary,
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): SessionDayUsage[] {
  return (session.dailyUsage ?? []).filter(
    (d) => (d.day >= fromKey && d.day <= toKey) || (includeUndated && d.day === UNDATED_DAY)
  )
}

function filterByDateRange(
  sessions: SessionSummary[],
  from: Date,
  to: Date,
  includeUndated: boolean
): SessionSummary[] {
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  return sessions.filter((s) =>
    s.dailyUsage?.length
      ? daysInRange(s, fromKey, toKey, includeUndated).length > 0
      : // A summary written before per-day accounting existed. Kept so an
        // out-of-date cache degrades to the old behaviour instead of vanishing.
        isWithinRange(s.lastTimestamp, from, to)
  )
}

/**
 * Undated activity summed across every session, independent of the selected
 * range. Reported unconditionally so the range picker can disclose "N
 * messages have no date" no matter what is selected — including a calendar
 * range that just excluded them from its own totals, and `all` even though
 * it also folds this figure into the totals below. Reading straight from
 * `session.dailyUsage` (not `filtered`, and not through `daysInRange`) is
 * deliberate: a session whose only activity is undated has nothing to pass a
 * calendar-bounded `filterByDateRange` and would otherwise disappear from
 * this count exactly where it matters most — a narrow range on a corpus that
 * still has an undated record in it.
 */
function undatedActivityTotals(sessions: SessionSummary[]): {
  messages: number
  responses: number
} {
  let messages = 0
  let responses = 0
  for (const s of sessions) {
    const undated = s.dailyUsage?.find((d) => d.day === UNDATED_DAY)
    if (undated) {
      messages += undated.messageCount
      responses += undated.responseCount
    }
  }
  return { messages, responses }
}

// ─── buildDailyUsage ─────────────────────────────────────────────────────────

/** An idle day's row: every figure zero, nothing yet attributed to it. */
function zeroDailyUsage(date: string): DailyUsage {
  return {
    id: date,
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    sessionCount: 0,
    messageCount: 0,
    estimatedCost: 0,
  }
}

/**
 * One row per day that had activity — NOT one row per day in the range. A day
 * with no session active on it never reaches the loop below, so it never gets
 * a `Map` entry, and simply isn't in the returned array.
 *
 * That is exactly the "7d shows 6 days" defect: this function's own idea of
 * "the range" is implicit in whichever sessions happen to have activity in
 * it, not the calendar span the caller resolved. Zero-filling in here would
 * require this function to also know whether it may (`today`/`7d`/`30d`/
 * custom) or may not (`all`, `new Date(0)`-bounded) synthesise empty days —
 * `computeAnalytics` already carries that distinction as `includeUndated`, so
 * the fill happens exactly once, there, via `zeroFillDailySeries` — see its
 * call site below for the reasoning. `effortAnalytics.effortOverTime` is
 * filled the same way, and `cacheAnalytics.dailyHitRatio` inherits this
 * fixed `dailyUsage` as its own input, so every day-keyed series in this
 * file ends up agreeing on how many days the selected range has.
 */
function buildDailyUsage(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): DailyUsage[] {
  const byDate = new Map<string, DailyUsage>()

  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      let existing = byDate.get(d.day)
      if (!existing) {
        existing = zeroDailyUsage(d.day)
        byDate.set(d.day, existing)
      }
      existing.inputTokens += d.inputTokens
      existing.outputTokens += d.outputTokens
      existing.cacheReadTokens += d.cacheReadTokens
      existing.cacheCreationTokens += d.cacheCreationTokens
      existing.cacheCreation5mTokens += d.cacheCreation5mTokens
      existing.cacheCreation1hTokens += d.cacheCreation1hTokens
      existing.messageCount += d.messageCount
      existing.estimatedCost += d.estimatedCost
      // A session active on three days is one session on each of them — but it
      // is still one session over the range, so these cannot be summed to get a
      // distinct-session count.
      existing.sessionCount++
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Usage totals for the selected period only, across the given sessions. */
function totalsInRange(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): {
  tokens: number
  cacheTokens: number
  cost: number
  messages: number
  unpricedResponses: number
  incompleteUsageResponses: number
  responsesWithoutCompletionSignal: number
  reducedConfidenceResponses: number
} {
  let tokens = 0
  let cacheTokens = 0
  let cost = 0
  let messages = 0
  let unpricedResponses = 0
  let incompleteUsageResponses = 0
  let responsesWithoutCompletionSignal = 0
  let reducedConfidenceResponses = 0
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      tokens += d.inputTokens + d.outputTokens
      cacheTokens += d.cacheReadTokens + d.cacheCreationTokens
      cost += d.estimatedCost
      messages += d.messageCount
      unpricedResponses += d.unpricedResponses
      incompleteUsageResponses += d.incompleteUsageResponses
      responsesWithoutCompletionSignal += d.responsesWithoutCompletionSignal
      reducedConfidenceResponses += d.reducedConfidenceResponses
    }
  }
  return {
    tokens,
    cacheTokens,
    cost,
    messages,
    unpricedResponses,
    incompleteUsageResponses,
    responsesWithoutCompletionSignal,
    reducedConfidenceResponses,
  }
}

// ─── buildProjectCosts ────────────────────────────────────────────────────────

/**
 * Maps a session's own id to the id of the `Project` that currently owns it,
 * per `projects[].sessions` — which, after `project-scanner.ts`'s
 * `mergeProjectsByResolvedPath`, can be a DIFFERENT id than the session's own
 * physical `projectId` (a git worktree and its main checkout share one
 * merged `Project`, but each session still carries the real on-disk
 * directory it was parsed from — see that function's doc comment for why
 * `SessionSummary.projectId` is never rewritten). Grouping by the session's
 * raw `projectId` instead of this owner id split one merged project back
 * into up to N rows keyed by physical directory, undercounting the survivor
 * row and — worse — making the merged project vanish entirely from a date
 * range that only covers a non-survivor directory's sessions, since no row
 * would ever carry the survivor's id in that case.
 *
 * Exported so every consumer that needs "which project does this session
 * belong to" (as opposed to "which physical directory is its transcript
 * in", which stays `session.projectId`) builds it the same way instead of
 * re-deriving it — `tray-snapshot.ts`'s `todaysProjectCount` and this file's
 * own `computeLatencyAnalytics` both use it.
 */
export function buildSessionOwnerMap(projects: Project[]): Map<string, string> {
  const owner = new Map<string, string>()
  for (const project of projects) {
    for (const session of project.sessions) {
      owner.set(session.id, project.id)
    }
  }
  return owner
}

/**
 * Per-project totals for the selected period.
 *
 * These are a breakdown of the period's total, so they must sum to it. Summing
 * each session's lifetime figures instead made the parts exceed the whole
 * whenever a session straddled the edge of the window.
 */
function buildProjectCosts(
  sessions: SessionSummary[],
  projects: Project[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): ProjectCost[] {
  const byProject = new Map<string, ProjectCost>()
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const ownerOf = buildSessionOwnerMap(projects)

  for (const s of sessions) {
    const days = daysInRange(s, fromKey, toKey, includeUndated)
    if (days.length === 0) continue

    // `ownerOf.get(s.id)` misses, and this falls back to the session's own
    // physical `projectId`, whenever `s` isn't listed in any
    // `projects[].sessions`. That is NOT a hypothetical: both real production
    // callers (`analytics.handlers.ts`, `tray-snapshot.ts`) derive `sessions`
    // as `projects.flatMap((p) => p.sessions)` so it can't happen there, but
    // this file's own `PROJECTS` test fixture deliberately leaves
    // `PROJECTS[0].sessions` empty and passes each test's real session
    // objects only through the `sessions` parameter — a convention roughly
    // 40 tests in this file rely on — so this branch is genuinely exercised,
    // repeatedly, right now. Verified directly, not assumed: forcing this
    // whole branch to skip the session instead of falling back breaks two of
    // those tests (`expected 1 to be 0`); only the identifying STRING it
    // substitutes is inconsequential to any current assertion (those tests
    // check that costs sum correctly, not which project id backs them),
    // which is a materially weaker claim than "unreachable."
    const projectId = ownerOf.get(s.id) ?? s.projectId
    let existing = byProject.get(projectId)
    if (!existing) {
      existing = {
        id: projectId,
        projectId,
        projectName: projectMap.get(projectId)?.name ?? projectId,
        totalCost: 0,
        totalTokens: 0,
        sessionCount: 0,
        messageCount: 0,
      }
      byProject.set(projectId, existing)
    }
    // One session counts once for the project however many days it spans.
    existing.sessionCount++
    for (const d of days) {
      existing.totalCost += d.estimatedCost
      existing.totalTokens += d.inputTokens + d.outputTokens
      existing.messageCount += d.messageCount
    }
  }

  return [...byProject.values()].sort((a, b) => b.totalCost - a.totalCost)
}

// ─── buildSessionPeriodRows ───────────────────────────────────────────────────

/**
 * Per-session rows for the Overview tab's session table, scoped to the
 * selected period.
 *
 * The renderer used to filter and total these itself from lifetime session
 * fields via `lastTimestamp`, which is exactly the membership disagreement
 * `daysInRange` exists to prevent (see its own doc comment): a session active
 * on two days either vanished from the table on the earlier one or showed
 * both days' totals on the later one. Building the row here, from the same
 * per-day rows every other date-scoped series reads, means there is one
 * membership rule and one set of period totals for this table to consume.
 */
function buildSessionPeriodRows(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): SessionPeriodRow[] {
  const rows: SessionPeriodRow[] = []

  for (const s of sessions) {
    const days = daysInRange(s, fromKey, toKey, includeUndated)
    if (days.length === 0) continue

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let estimatedCost = 0
    let messageCount = 0
    let parentMessageCount = 0
    for (const d of days) {
      totalInputTokens += d.inputTokens
      totalOutputTokens += d.outputTokens
      estimatedCost += d.estimatedCost
      messageCount += d.messageCount
      parentMessageCount += d.parentMessageCount
    }

    rows.push({
      id: s.id,
      sessionId: s.id,
      projectId: s.projectId,
      title: s.title,
      hasError: s.hasError,
      lastTimestamp: s.lastTimestamp,
      parentMessageCount,
      messageCount,
      totalInputTokens,
      totalOutputTokens,
      estimatedCost,
    })
  }

  return rows
}

// ─── buildModelUsage ──────────────────────────────────────────────────────────

/**
 * Model usage for the selected period only.
 *
 * Previously read each session's lifetime breakdown, so a day on which only
 * Sonnet ran still listed every model the session had ever used. Unrecognised
 * models are kept rather than skipped — dropping them made a fifth of real
 * turns disappear from the chart while still counting in the totals beside it.
 */
function buildModelUsage(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): ModelUsage[] {
  const byFamily = new Map<string, ModelUsage>()

  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      for (const m of d.models) {
        const existing = byFamily.get(m.family)
        if (existing) {
          existing.turnCount += m.turnCount
          existing.totalInputTokens += m.inputTokens
          existing.totalOutputTokens += m.outputTokens
        } else {
          byFamily.set(m.family, {
            id: m.family,
            model: m.family,
            turnCount: m.turnCount,
            totalInputTokens: m.inputTokens,
            totalOutputTokens: m.outputTokens,
          })
        }
      }
    }
  }

  return [...byFamily.values()].sort((a, b) => b.turnCount - a.turnCount)
}

const TOP_COMPACTION_LIMIT = 15

// ─── computeCacheAnalytics ────────────────────────────────────────────────────

function computeCacheAnalytics(
  sessions: SessionSummary[],
  dailyUsage: DailyUsage[],
  pricingTable: Record<ModelFamily, ModelPricing>,
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): CacheAnalytics {
  // Scoped to the selected period, matching the daily series shown beside
  // these figures. Summing session lifetimes here would report cache activity
  // from days the user did not select.
  let totalCacheReadTokens = 0
  let totalCacheWriteTokens = 0
  let totalCache5mTokens = 0
  let totalCache1hTokens = 0
  // Coverage, not a cost figure: every unknown-model guard below (`m.family
  // === 'unknown'`, `!p`) already excludes these responses' cache activity
  // from savings rather than pricing them at a guess. Counting them
  // separately is what lets a `0` net-savings figure read as "we can't price
  // this" instead of "no cache activity happened" — see `CacheAnalytics.unpricedResponses`.
  let unpricedResponses = 0
  // Same rationale, for the three completeness signals `SessionDiagnostics`
  // carries — see `CacheAnalytics.incompleteUsageResponses` and its siblings.
  let incompleteUsageResponses = 0
  let responsesWithoutCompletionSignal = 0
  let reducedConfidenceResponses = 0

  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      totalCacheReadTokens += d.cacheReadTokens
      totalCacheWriteTokens += d.cacheCreationTokens
      totalCache5mTokens += d.cacheCreation5mTokens
      totalCache1hTokens += d.cacheCreation1hTokens
      unpricedResponses += d.unpricedResponses
      incompleteUsageResponses += d.incompleteUsageResponses
      responsesWithoutCompletionSignal += d.responsesWithoutCompletionSignal
      reducedConfidenceResponses += d.reducedConfidenceResponses
    }
  }

  // Cache hit ratio = cacheRead / (input + cacheRead + cacheCreation)
  //
  // The three token pools in the Anthropic API are mutually exclusive:
  //   input_tokens            — fresh tokens processed this turn (not cached)
  //   cache_read_input_tokens — tokens served from an existing cache entry (cheap)
  //   cache_creation_input_tokens — tokens written to a new cache entry (expensive)
  //
  // Total context seen by the model = all three combined.
  // Hit ratio = share of that total context that was served cheaply from cache.
  //
  // Note: input_tokens in API responses is already EXCLUSIVE of cache_read and
  // cache_creation tokens, so summing all three gives the true total context size.
  let totalFreshInputTokens = 0
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated))
      totalFreshInputTokens += d.inputTokens
  }
  const hitRatioDenominator = totalFreshInputTokens + totalCacheReadTokens + totalCacheWriteTokens
  const hitRatio = hitRatioDenominator > 0 ? totalCacheReadTokens / hitRatioDenominator : 0

  // An uncached request pays ordinary input rates for tokens that caching wrote
  // at a premium — 1.25x input for a 5-minute write, 2x for an hour. Adding
  // only the read discount to the actual cost left those premiums inside the
  // "without cache" baseline, overstating savings. Measured on real history the
  // overstatement is $526.62 against $24,608.05 of true net savings (2.14%).
  // Net savings can legitimately be negative over a write-heavy window. An
  // unrecognised model contributes nothing here rather than a guessed amount,
  // matching how its cost is left unpriced.
  let grossReadSavings = 0
  let writePremium = 0
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      for (const m of d.models) {
        if (m.family === 'unknown') continue
        const p = pricingTable[m.family]
        if (!p) continue
        grossReadSavings += (m.cacheReadTokens / 1_000_000) * (p.input - p.cacheRead)
        writePremium +=
          (m.cacheCreation5mTokens / 1_000_000) * (p.cache5m - p.input) +
          (m.cacheCreation1hTokens / 1_000_000) * (p.cache1h - p.input) +
          // An unsplit write (no TTL reported) is still a genuine cache write and
          // still carries a premium over ordinary input. Priced at the 5-minute
          // rate for consistency with the tier-cost display below, which prices
          // this same remainder the same way.
          (m.cacheCreationUnknownTtlTokens / 1_000_000) * (p.cache5m - p.input)
      }
    }
  }
  const netSavings = grossReadSavings - writePremium

  // The period's cost, so the cache tab cannot contradict the overview beside
  // it. Summing session lifetimes here reported $11 against a $1 total on a
  // one-day selection.
  let actualCost = 0
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) actualCost += d.estimatedCost
  }
  const uncachedSameWorkloadCost = actualCost + netSavings

  // Average reuse rate: how many times each cache write was reused on average.
  // Zero writes is an undefined denominator, not zero reuse: the write may
  // have happened just before the range started.
  const averageReuseRate =
    totalCacheWriteTokens > 0 ? totalCacheReadTokens / totalCacheWriteTokens : null

  // Daily hit ratios — same formula: read / (input + read + creation)
  const dailyHitRatio: DailyHitRatio[] = dailyUsage
    .filter((d) => d.inputTokens + d.cacheReadTokens + d.cacheCreationTokens > 0)
    .map((d) => {
      const denominator = d.inputTokens + d.cacheReadTokens + d.cacheCreationTokens
      return {
        id: d.date,
        date: d.date,
        ratio: denominator > 0 ? d.cacheReadTokens / denominator : 0,
      }
    })

  // A drop is only comparable between consecutive calendar days. Comparing
  // array neighbours flagged a nine-day gap as if it were an overnight change.
  // This is an observed drop, not a diagnosis: workload mix and ordinary cache
  // expiry lower the ratio without anything being invalidated.
  const hitRatioDropDays: string[] = []
  for (let i = 1; i < dailyHitRatio.length; i++) {
    const prevDate = new Date(`${dailyHitRatio[i - 1].date}T00:00:00`)
    const currDate = new Date(`${dailyHitRatio[i].date}T00:00:00`)
    const dayGap = Math.round((currDate.getTime() - prevDate.getTime()) / 86_400_000)
    if (dayGap !== 1) continue
    if (dailyHitRatio[i - 1].ratio > 0.3 && dailyHitRatio[i].ratio < 0.1) {
      hitRatioDropDays.push(dailyHitRatio[i].date)
    }
  }

  // Per-session efficiency, scoped to the period and priced from the models the
  // session actually ran — not from whichever model it used most.
  const sessionEfficiency: SessionCacheEfficiency[] = sessions
    .map((s) => {
      const days = daysInRange(s, fromKey, toKey, includeUndated)
      let input = 0
      let reads = 0
      let writes = 0
      let savings = 0
      for (const d of days) {
        input += d.inputTokens
        reads += d.cacheReadTokens
        writes += d.cacheCreationTokens
        for (const m of d.models) {
          if (m.family === 'unknown') continue
          const p = pricingTable[m.family]
          if (!p) continue
          savings += (m.cacheReadTokens / 1_000_000) * (p.input - p.cacheRead)
        }
      }
      const denominator = input + reads + writes
      return {
        id: s.id,
        sessionId: s.id,
        sessionTitle: s.title,
        hitRatio: denominator > 0 ? reads / denominator : 0,
        cacheReadTokens: reads,
        cacheWriteTokens: writes,
        savingsAmount: savings,
        primaryModel: s.latestModel ?? s.dominantModel,
      }
    })
    .filter((e) => e.cacheReadTokens + e.cacheWriteTokens > 0)
    // Rank by the advertised criterion before truncating. Sorting by read
    // volume first and re-sorting the survivors in the renderer could drop the
    // best session before it was ever compared.
    .sort((a, b) => b.hitRatio - a.hitRatio)
    .slice(0, 20)

  // Model savings breakdown, over the selected period. `totalSavings` is the
  // gross read discount alone; `netSavings` subtracts that same model's
  // cache-write premium, using the identical known/priced guard for both
  // terms — pricing the premium for a row whose gross was zeroed out (unknown
  // family, or no pricing entry) would make net wrong in the model's favor.
  const modelSavingsMap = new Map<string, ModelCacheSavings>()
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      for (const m of d.models) {
        const p = pricingTable[m.family]
        const known = m.family !== 'unknown' && !!p
        const perMTok = known ? p.input - p.cacheRead : 0
        const gross = (m.cacheReadTokens / 1_000_000) * perMTok
        const premium = known
          ? (m.cacheCreation5mTokens / 1_000_000) * (p.cache5m - p.input) +
            (m.cacheCreation1hTokens / 1_000_000) * (p.cache1h - p.input) +
            // Same unsplit-write remainder as the aggregate premium above,
            // priced at the same 5-minute rate — an asymmetric guard here
            // would make this model's net savings disagree with the total.
            (m.cacheCreationUnknownTtlTokens / 1_000_000) * (p.cache5m - p.input)
          : 0
        const net = gross - premium
        const existing = modelSavingsMap.get(m.family)
        if (existing) {
          existing.cacheReadTokens += m.cacheReadTokens
          existing.totalSavings += gross
          existing.netSavings += net
        } else {
          modelSavingsMap.set(m.family, {
            id: m.family,
            model: m.family,
            cacheReadTokens: m.cacheReadTokens,
            savingsPerMTok: perMTok,
            totalSavings: gross,
            netSavings: net,
          })
        }
      }
    }
  }

  // Tier cost breakdown, priced per model rather than at the session's
  // most-used model — a 5m write on Opus costs more than one on Haiku.
  let cost5m = 0
  let cost1h = 0
  let costUnknownTtl = 0
  let totalCacheUnknownTtlTokens = 0
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      for (const m of d.models) {
        // Token count is reported regardless of pricing, matching how the 5m
        // and 1h tiers are counted above — a model with no pricing entry
        // still had real cache-write activity.
        totalCacheUnknownTtlTokens += m.cacheCreationUnknownTtlTokens
        const p = pricingTable[m.family]
        if (m.family === 'unknown' || !p) continue
        cost5m += (m.cacheCreation5mTokens / 1_000_000) * p.cache5m
        cost1h += (m.cacheCreation1hTokens / 1_000_000) * p.cache1h
        // No TTL was reported for this remainder, so there is no tier rate to
        // charge it at. The 5-minute rate is a fallback estimate — kept in its
        // own bucket rather than folded into cost5m, so it never masquerades
        // as a known 5-minute write.
        costUnknownTtl += (m.cacheCreationUnknownTtlTokens / 1_000_000) * p.cache5m
      }
    }
  }

  // Compaction analytics, scoped to the period. Compaction events carry their
  // own timestamps, so a session that compacted last week does not belong
  // behind today's selection.
  interface CompactionRollup {
    session: SessionSummary
    compactions: number
    tokensRemoved: number
    maxPreTokens: number
  }
  const compactionRollups: CompactionRollup[] = []
  for (const s of sessions) {
    let compactions = 0
    let tokensRemoved = 0
    let maxPreTokens = 0
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      compactions += d.compactions
      tokensRemoved += d.tokensRemovedByCompaction
      // Max-of-maxes across days equals the global max; max-of-sums (or the
      // sum-over-count mean this replaced) would report the busiest day
      // instead of the single largest pre-compaction context.
      maxPreTokens = Math.max(maxPreTokens, d.maxPreCompactionTokens)
    }
    if (compactions > 0)
      compactionRollups.push({ session: s, compactions, tokensRemoved, maxPreTokens })
  }

  const totalCompactions = compactionRollups.reduce((n, r) => n + r.compactions, 0)
  const totalTokensRemoved = compactionRollups.reduce((n, r) => n + r.tokensRemoved, 0)
  const avgTokensRemovedPerSession =
    compactionRollups.length > 0 ? totalTokensRemoved / compactionRollups.length : 0

  // Hypothetical only — see `SessionCompactionEntry.estimatedCostAvoided`.
  // Priced from the session's dominant model because compaction clears
  // context rather than producing tokens, so the cleared tokens cannot be
  // attributed to a specific model; unrecognised models avoid nothing rather
  // than a guessed amount. This does not net out the retained summary, the
  // summarisation call's own cost, or later cache reuse, so it must never be
  // presented as a measured saving — UI labels it explicitly hypothetical.
  const costAvoidedFor = (r: CompactionRollup): number => {
    const family = getModelFamily(r.session.dominantModel)
    const p = pricingTable[family]
    if (family === 'unknown' || !p) return 0
    return (r.tokensRemoved / 1_000_000) * p.input
  }

  const ranked = [...compactionRollups].sort((a, b) => b.tokensRemoved - a.tokensRemoved)
  const topCompactionSessions: SessionCompactionEntry[] = ranked
    .slice(0, TOP_COMPACTION_LIMIT)
    .map((r) => ({
      id: r.session.id,
      sessionTitle: r.session.title,
      compactionCount: r.compactions,
      totalTokensRemoved: r.tokensRemoved,
      // The largest single pre-compaction context, matching what session
      // details shows. Dividing the total removed by the compaction count is
      // a mean, which is not what "peak" means.
      peakContextTokens: r.maxPreTokens,
      estimatedCostAvoided: costAvoidedFor(r),
      primaryModel: r.session.dominantModel,
    }))

  const estimatedCostAvoided = ranked.reduce((n, r) => n + costAvoidedFor(r), 0)

  const compactionAnalytics: CompactionAnalytics = {
    totalCompactions,
    totalTokensRemoved,
    avgTokensRemovedPerSession,
    estimatedCostAvoided,
    topSessions: topCompactionSessions,
  }

  return {
    hitRatio,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    grossReadSavings,
    writePremium,
    netSavings,
    uncachedSameWorkloadCost,
    actualCost,
    averageReuseRate,
    dailyHitRatio,
    totalCache5mTokens,
    totalCache1hTokens,
    totalCacheUnknownTtlTokens,
    tierCostBreakdown: { cost5m, cost1h, costUnknownTtl },
    sessionEfficiency,
    modelSavings: [...modelSavingsMap.values()],
    hitRatioDropDays,
    compactionAnalytics,
    unpricedResponses,
    incompleteUsageResponses,
    responsesWithoutCompletionSignal,
    reducedConfidenceResponses,
  }
}

// ─── computeModelEfficiency ───────────────────────────────────────────────────

/**
 * Per-model efficiency for the selected period.
 *
 * Read each session's lifetime breakdown, so the efficiency table disagreed
 * with the turn-distribution chart on the same tab whenever a range was
 * narrower than a session's life.
 */
function computeModelEfficiency(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): ModelEfficiencyRow[] {
  const byFamily = new Map<
    string,
    {
      turnCount: number
      inputTokens: number
      cacheReadTokens: number
      cacheCreation5mTokens: number
      cacheCreation1hTokens: number
      cacheCreationUnknownTtlTokens: number
      totalOutputTokens: number
      totalCost: number
    }
  >()

  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      for (const m of d.models) {
        const existing = byFamily.get(m.family)
        if (existing) {
          existing.turnCount += m.turnCount
          existing.inputTokens += m.inputTokens
          existing.cacheReadTokens += m.cacheReadTokens
          existing.cacheCreation5mTokens += m.cacheCreation5mTokens
          existing.cacheCreation1hTokens += m.cacheCreation1hTokens
          existing.cacheCreationUnknownTtlTokens += m.cacheCreationUnknownTtlTokens
          existing.totalOutputTokens += m.outputTokens
          // Skip nulls rather than adding them as zero: an unpriced model's
          // rows still contribute their tokens above, just not to totalCost.
          if (m.estimatedCost !== null) existing.totalCost += m.estimatedCost
        } else {
          byFamily.set(m.family, {
            turnCount: m.turnCount,
            inputTokens: m.inputTokens,
            cacheReadTokens: m.cacheReadTokens,
            cacheCreation5mTokens: m.cacheCreation5mTokens,
            cacheCreation1hTokens: m.cacheCreation1hTokens,
            cacheCreationUnknownTtlTokens: m.cacheCreationUnknownTtlTokens,
            totalOutputTokens: m.outputTokens,
            totalCost: m.estimatedCost ?? 0,
          })
        }
      }
    }
  }

  const totalCost = [...byFamily.values()].reduce((s, e) => s + e.totalCost, 0)

  return [...byFamily.entries()]
    .map(([family, e]) => ({
      id: family,
      model: family,
      turnCount: e.turnCount,
      inputTokens: e.inputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheCreation5mTokens: e.cacheCreation5mTokens,
      cacheCreation1hTokens: e.cacheCreation1hTokens,
      cacheCreationUnknownTtlTokens: e.cacheCreationUnknownTtlTokens,
      totalOutputTokens: e.totalOutputTokens,
      avgOutputPerTurn: e.turnCount > 0 ? e.totalOutputTokens / e.turnCount : 0,
      totalCost: e.totalCost,
      costPerTurn: e.turnCount > 0 ? e.totalCost / e.turnCount : 0,
      percentOfTotalCost: totalCost > 0 ? (e.totalCost / totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.totalCost - a.totalCost)
}

// ─── computeDailyModelCost ────────────────────────────────────────────────────

function computeDailyModelCost(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): DailyModelCost[] {
  const byDateModel = new Map<string, DailyModelCost>()

  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      for (const m of d.models) {
        const key = `${d.day}-${m.family}`
        const existing = byDateModel.get(key)
        if (existing) {
          // Skip nulls rather than adding them as zero — see computeModelEfficiency.
          if (m.estimatedCost !== null) existing.cost += m.estimatedCost
        } else {
          byDateModel.set(key, {
            id: key,
            date: d.day,
            model: m.family,
            cost: m.estimatedCost ?? 0,
          })
        }
      }
    }
  }

  return [...byDateModel.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)
  )
}

// ─── computeLatencyAnalytics ──────────────────────────────────────────────────

/**
 * Latency for turns that happened inside the period.
 *
 * Turn durations carry their own timestamp, so they belong to the day they
 * occurred on. Counting every turn of any session merely *active* in the range
 * put a fortnight of latency behind a one-day selection — the same mistake as
 * attributing a session's whole history to its last day.
 *
 * Deliberately does NOT take `includeUndated`, unlike every other date-scoped
 * aggregate in this file: an undated turn is excluded from every calendar
 * range, `all` included, because a latency percentile is sensitive to exactly
 * which durations feed it. That ruling currently governs an EMPTY SET, and
 * this comment previously claimed otherwise. `judgeResponse`
 * (`response-observability.ts`) is the only producer of a `TurnDuration`, and
 * it builds one only when `durationMs > 0`; `durationMs` is `NaN` — never
 * `> 0` — whenever either timestamp fails to parse, and it is not computed at
 * all unless both are present. So every `assistantTimestamp` reaching this
 * function is present AND parsable, `toDayKeyOrUndated` never returns
 * `UNDATED_DAY` here, and no turn is ever excluded by the undated policy.
 * That invariant is pinned at its source — see "never yields a turn duration
 * from a timestamp it could not parse" in `response-observability.test.ts` —
 * rather than defended by an unreachable branch here.
 *
 * What was deleted, and why it is not a loss of protection: this used to wrap
 * the day check in `if (td.assistantTimestamp)`, which kept a timestamp-less
 * turn in EVERY range unconditionally — including `today` — while the comment
 * above it asserted such a turn was excluded "the same way" as an unparsable
 * one. The two undated sub-cases were documented as symmetric and implemented
 * as opposites. They are now genuinely symmetric: both route through
 * `toDayKeyOrUndated` to `UNDATED_DAY`, which sorts below every real day key,
 * so neither can be attributed to a calendar window it cannot honestly claim.
 */
function computeLatencyAnalytics(
  sessions: SessionSummary[],
  projects: Project[],
  fromKey: string,
  toKey: string
): LatencyAnalytics {
  const allDurations: number[] = []
  const postCompactionDurations: number[] = []
  const normalDurations: number[] = []
  const slowTurnEntries: SlowTurnEntry[] = []
  // Same fix as `buildProjectCosts`: `SlowTurnEntry.projectId` must identify
  // the OWNING (possibly merged) project, not the turn's session's physical
  // directory — `latency-tab.tsx` filters `slowestTurns` by
  // `selectedProjectIds`, which are always survivor ids from the merged
  // project list, so a physical id here would silently drop every slow turn
  // from a merged-away directory whenever its project is selected.
  const ownerOf = buildSessionOwnerMap(projects)

  for (const s of sessions) {
    for (const td of s.turnDurations ?? []) {
      if (td.durationMs <= 0) continue
      // One day-key derivation for both undated sub-cases — absent timestamp
      // and unparsable timestamp alike — through the same shared helper every
      // other day-key site in this codebase uses.
      //
      // REQUIRED here, not merely consistent. `assistantTimestamp` is
      // `string | undefined`, and `toDateKey(undefined)` THROWS: it calls
      // `.getFullYear()` on the undefined it was handed. Deleting the
      // enclosing `if (td.assistantTimestamp)` guard (see this function's doc
      // comment) is what made the absent case reach this line, so this helper
      // is now the only thing standing between a summary carrying a
      // timestamp-less turn and a crash in the analytics engine. Substituting
      // `toDateKey` here is caught by `analytics-scope.test.ts`'s two undated
      // latency tests.
      //
      // `judgeResponse` cannot produce such a turn, so nothing in the normal
      // pipeline reaches it — but a hand-built summary or a corrupted cache
      // entry can, and the difference between "excluded from the range" and
      // "throws" is not one to leave to the data.
      //
      // `fromKey`/`toKey` are always real calendar keys, and `UNDATED_DAY`
      // sorts below every one of them, so an undated turn would be excluded
      // from every range including `all`.
      const day = toDayKeyOrUndated(td.assistantTimestamp)
      if (day < fromKey || day > toKey) continue
      allDurations.push(td.durationMs)
      if (td.isPostCompaction) {
        postCompactionDurations.push(td.durationMs)
      } else {
        normalDurations.push(td.durationMs)
      }
      slowTurnEntries.push({
        id: `${s.id}-${td.turnIndex}`,
        sessionId: s.id,
        // Falls back to the physical id when this session isn't reachable
        // from any project in `projects` — see `buildProjectCosts`'s
        // identical fallback for why that's not hypothetical: both real
        // production callers avoid it, but this file's own `PROJECTS` test
        // fixture (used below, e.g. the `slowestTurns` test) deliberately
        // leaves `.sessions` empty, so this branch is genuinely exercised
        // here too — only the specific string it substitutes is untested.
        projectId: ownerOf.get(s.id) ?? s.projectId,
        sessionTitle: s.title,
        turnIndex: td.turnIndex,
        durationMs: td.durationMs,
        isPostCompaction: td.isPostCompaction,
        model: td.model ?? s.dominantModel,
      })
    }
  }

  const sorted = [...allDurations].sort((a, b) => a - b)

  // Histogram buckets
  const buckets: LatencyBucket[] = [
    { id: '0-1s', label: '0–1s', count: 0 },
    { id: '1-5s', label: '1–5s', count: 0 },
    { id: '5-30s', label: '5–30s', count: 0 },
    { id: '30s+', label: '30s+', count: 0 },
  ]

  for (const d of allDurations) {
    if (d < 1000) buckets[0].count++
    else if (d < 5000) buckets[1].count++
    else if (d < 30000) buckets[2].count++
    else buckets[3].count++
  }

  // Degrading sessions: max turn duration > 2× median and median itself is slow.
  // Unlike everything else in this function, this stays a lifetime judgement —
  // a median-versus-max comparison describes a whole session's trajectory and
  // cannot be honestly scoped to a window without recomputing the median from
  // a truncated sample, which would answer a different question.
  const lifetimeDegradingSessionIds = sessions
    .filter((s) => {
      const med = s.observability?.medianTurnDurationMs
      const max = s.observability?.maxTurnDurationMs
      return med !== undefined && max !== undefined && max > 2 * med && med > 5000
    })
    .map((s) => s.id)

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

  return {
    medianDurationMs: percentile(sorted, 50),
    p95DurationMs: percentile(sorted, 95),
    p99DurationMs: percentile(sorted, 99),
    histogram: buckets,
    slowestTurns: slowTurnEntries.sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
    postCompactionAvgMs: avg(postCompactionDurations),
    normalAvgMs: avg(normalDurations),
    lifetimeDegradingSessionIds,
  }
}

// ─── computeEffortAnalytics ───────────────────────────────────────────────────

/**
 * Effort is judged once per API response, and every response carries its own
 * timestamp (Task 5's `flushPendingResponse`), so the distribution is
 * date-scopeable. Summing a session's lifetime distribution for any session
 * merely *active* in the range charged a one-day view for a fortnight of
 * thinking — the same defect as attributing a session's whole history to its
 * last day. Cost is attributed from the period only, same as before: charging
 * a one-day view for a fortnight of spend made the effort tab contradict the
 * overview.
 */
function computeEffortAnalytics(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): EffortAnalytics {
  const totals = { low: 0, medium: 0, high: 0, ultrathink: 0 }
  const costs: Record<EffortLevel, number> = { low: 0, medium: 0, high: 0, ultrathink: 0 }

  for (const s of sessions) {
    const days = daysInRange(s, fromKey, toKey, includeUndated)
    const ed = { low: 0, medium: 0, high: 0, ultrathink: 0 }
    let parentCost = 0
    for (const d of days) {
      ed.low += d.effortDistribution.low
      ed.medium += d.effortDistribution.medium
      ed.high += d.effortDistribution.high
      ed.ultrathink += d.effortDistribution.ultrathink
      parentCost += d.parentEstimatedCost
    }
    totals.low += ed.low
    totals.medium += ed.medium
    totals.high += ed.high
    totals.ultrathink += ed.ultrathink

    // Cost attribution: use parent-session-only cost (exclude subagent rollup) so
    // the proportional split stays consistent with the parent effort distribution.
    const total = ed.low + ed.medium + ed.high + ed.ultrathink
    if (total > 0 && parentCost > 0) {
      costs.low += parentCost * (ed.low / total)
      costs.medium += parentCost * (ed.medium / total)
      costs.high += parentCost * (ed.high / total)
      costs.ultrathink += parentCost * (ed.ultrathink / total)
    }
  }

  const levels: EffortLevel[] = ['low', 'medium', 'high', 'ultrathink']
  const costByEffort: EffortCostBreakdown[] = levels.map((level) => ({
    id: level,
    level,
    turnCount: totals[level],
    totalCost: costs[level],
    avgCostPerTurn: totals[level] > 0 ? costs[level] / totals[level] : 0,
  }))

  // Effort over time, by the day each response actually landed on — not by
  // the session's last timestamp, which piled a session's whole lifetime
  // distribution onto whichever day it last touched.
  const byDate = new Map<string, typeof totals>()
  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      const existing = byDate.get(d.day) ?? { low: 0, medium: 0, high: 0, ultrathink: 0 }
      existing.low += d.effortDistribution.low
      existing.medium += d.effortDistribution.medium
      existing.high += d.effortDistribution.high
      existing.ultrathink += d.effortDistribution.ultrathink
      byDate.set(d.day, existing)
    }
  }

  const effortOverTime = [...byDate.entries()]
    .map(([date, dist]) => ({ id: date, date, distribution: dist }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return { distribution: totals, costByEffort, effortOverTime }
}

// ─── computeParallelToolAnalytics ─────────────────────────────────────────────

/**
 * Each parallel-tool group is judged per response and lands on the day that
 * response was flushed on (see `flushPendingResponse`), so — like effort —
 * it is date-scopeable. Summing a session's lifetime `parallelToolCallCount`
 * for any session active in the range made a single day's selection show a
 * fortnight of parallelism.
 */
function computeParallelToolAnalytics(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): ParallelToolAnalytics {
  let totalParallelGroups = 0
  let maxParallelDegree = 0
  let totalToolsInGroups = 0
  const groupSizeCounts = new Map<number, number>()

  for (const s of sessions) {
    for (const d of daysInRange(s, fromKey, toKey, includeUndated)) {
      totalParallelGroups += d.parallelToolGroups
      if (d.maxParallelDegree > maxParallelDegree) {
        maxParallelDegree = d.maxParallelDegree
      }
      // We only have counts from the day row, not a true group-size
      // distribution. Use that day's maxParallelDegree as a proxy for the
      // size of every group on the day, same approximation as before.
      if (d.parallelToolGroups > 0 && d.maxParallelDegree > 0) {
        totalToolsInGroups += d.parallelToolGroups * d.maxParallelDegree
        const count = groupSizeCounts.get(d.maxParallelDegree) ?? 0
        groupSizeCounts.set(d.maxParallelDegree, count + d.parallelToolGroups)
      }
    }
  }

  const avgToolsPerGroup = totalParallelGroups > 0 ? totalToolsInGroups / totalParallelGroups : 0

  const distribution: ParallelToolBucket[] = [...groupSizeCounts.entries()]
    .map(([toolCount, occurrences]) => ({ id: toolCount, toolCount, occurrences }))
    .sort((a, b) => a.toolCount - b.toolCount)

  return {
    totalParallelGroups,
    avgToolsPerGroup,
    maxParallelDegree,
    distribution,
  }
}

// ─── computeSessionHealthSummary ─────────────────────────────────────────────

const SES001_COST_THRESHOLD = 25.0
const SES002_COMPACTION_THRESHOLD = 5
const SES003_TOKEN_THRESHOLD = 2_000_000
const SES004_STALE_DAYS = 14
// Halved when message counting moved from records to API responses: the old
// value of 10 was calibrated against counts inflated ~2.09x.
const SES004_MIN_MESSAGES = 5
const TOP_UNHEALTHY_LIMIT = 10

function evaluateSessionFlags(session: SessionSummary): LintCheckId[] {
  const flags: LintCheckId[] = []
  const nowMs = Date.now()
  const totalTokens = session.totalInputTokens + session.totalOutputTokens
  const staleDaysMs = SES004_STALE_DAYS * 24 * 60 * 60 * 1000

  if (session.estimatedCost > SES001_COST_THRESHOLD) flags.push('SES001')
  if (session.compactionCount >= SES002_COMPACTION_THRESHOLD) flags.push('SES002')
  if (totalTokens > SES003_TOKEN_THRESHOLD) flags.push('SES003')
  if (
    nowMs - new Date(session.lastTimestamp).getTime() > staleDaysMs &&
    session.messageCount >= SES004_MIN_MESSAGES
  ) {
    flags.push('SES004')
  }
  if (session.hasError) flags.push('SES005')
  if (session.observability.hasIdleZombieGap) flags.push('SES006')

  return flags
}

function worstSeverityForFlags(flags: LintCheckId[]): LintSeverity {
  const ERROR_FLAGS: LintCheckId[] = []
  const WARNING_FLAGS: LintCheckId[] = ['SES001', 'SES002', 'SES003', 'SES005', 'SES006']
  if (flags.some((f) => ERROR_FLAGS.includes(f))) return 'error'
  if (flags.some((f) => WARNING_FLAGS.includes(f))) return 'warning'
  return 'info'
}

function computeSessionHealthSummary(
  sessions: SessionSummary[],
  fromKey: string,
  toKey: string,
  includeUndated: boolean
): SessionHealthSummary {
  let cleanCount = 0
  let warningCount = 0
  let errorCount = 0
  const unhealthyEntries: SessionHealthEntry[] = []
  const dailyMap = new Map<string, { clean: number; flagged: number }>()

  for (const session of sessions) {
    // The verdict is a judgement about the session as a whole (lifetime cost,
    // compaction count, staleness), so it is computed once per session here —
    // unlike the trend below, it does not move with the selected date range.
    const flags = evaluateSessionFlags(session)
    const isClean = flags.length === 0

    if (isClean) {
      cleanCount++
    } else {
      const severity = worstSeverityForFlags(flags)
      if (severity === 'error') errorCount++
      else warningCount++

      unhealthyEntries.push({
        sessionId: session.id,
        sessionTitle: session.title || session.id.slice(0, 8),
        projectId: session.projectId,
        flags,
        worstSeverity: severity,
        estimatedCost: session.estimatedCost,
        lastTimestamp: session.lastTimestamp,
      })
    }

    // Daily trend uses the same date-membership rule as every other
    // date-scoped series (see `daysInRange`, mirrored from
    // `computeEffortAnalytics`): a session active on two days contributes its
    // verdict to both day rows, and a legacy session with no `dailyUsage`
    // contributes to none — rather than piling the whole session onto
    // `toDateKey(session.lastTimestamp)`, which moved a session active
    // yesterday AND today entirely onto today.
    for (const d of daysInRange(session, fromKey, toKey, includeUndated)) {
      const day = dailyMap.get(d.day) ?? { clean: 0, flagged: 0 }
      if (isClean) day.clean++
      else day.flagged++
      dailyMap.set(d.day, day)
    }
  }

  const topUnhealthy = [...unhealthyEntries]
    .sort((a, b) => b.estimatedCost - a.estimatedCost)
    .slice(0, TOP_UNHEALTHY_LIMIT)

  const dailyHealthTrend = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }))

  return { cleanCount, warningCount, errorCount, topUnhealthy, dailyHealthTrend }
}

// ─── computeAnalytics (main entry point) ─────────────────────────────────────

/**
 * The most days a bounded range's day-keyed series will ever be zero-filled
 * out to. Zero-filling exists to make a short, glanceable window (a week, a
 * month) honest about its idle days — not to synthesise years of empty rows
 * for a pathological custom range (2015 → today is ~4,000 days). `all` is
 * excluded from the fill outright, for the same underlying reason, via its
 * own check below; this cap is the same reasoning applied to a bounded
 * range large enough to cause the identical problem `all` was excluded for.
 * Comfortably above every built-in preset (30 days) with headroom for a
 * future "year" view.
 */
const MAX_ZERO_FILL_DAYS = 366

export function computeAnalytics(
  sessions: SessionSummary[],
  projects: Project[],
  dateRange: DateRange,
  pricingTable: Record<ModelFamily, ModelPricing>
): AnalyticsData {
  const { from, to } = resolveDateRange(dateRange)
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)

  // The `all` preset is the one range that can honestly claim the undated
  // bucket as part of "everything" — a calendar-bounded preset (`7d`, `30d`,
  // `90d`, custom) cannot attribute undated activity to the window it names,
  // so it stays excluded there. Computed once and passed down explicitly
  // (see `daysInRange`'s doc comment) rather than re-derived at each call
  // site, so every date-scoped total in this function agrees with every
  // other one on which bucket is in play for this render.
  const includeUndated = dateRange === 'all'
  const filtered = filterByDateRange(sessions, from, to, includeUndated)

  // ── Zero-fill gate for bounded day-keyed series ──────────────────────────
  //
  // `zeroFillTo` clamps only where the FILL is willing to manufacture a zero
  // row, not what data survives: the built-in presets never resolve `to`
  // later than today, but a custom range's `to` is user-supplied, and the
  // date picker does not stop someone from choosing a day next year —
  // filling out to that day would fabricate future zeros. A response
  // genuinely dated after today (clock skew, a timezone edge) is real
  // observed data, not a row this clamp should ever cause to disappear —
  // `zeroFillDailySeries` only ADDS missing days up to `zeroFillTo`, it never
  // drops an existing entry outside that bound (see its own doc comment).
  //
  // `shouldZeroFill` is also false for a custom range wide enough to exceed
  // `MAX_ZERO_FILL_DAYS` — the same reasoning as `all`, applied to a bounded
  // range large enough to cause the identical "synthesise thousands of empty
  // rows" problem. `all`'s lower bound is `new Date(0)`, so it would always
  // fail this same cap on its own (tens of thousands of days); the explicit
  // `dateRange !== 'all'` check ahead of it is not there to change that
  // outcome — it is there to short-circuit `&&` before `dateKeysInRange`
  // materialises and dates-formats that entire multi-decade array just to
  // measure its length, on every single `all`-scoped render.
  const today = new Date()
  const zeroFillTo = toDateKey(to) > toDateKey(today) ? today : to
  const shouldZeroFill =
    dateRange !== 'all' && dateKeysInRange(from, zeroFillTo).length <= MAX_ZERO_FILL_DAYS

  // Distinct sessions active in the period — not the sum of per-day counts, in
  // which a session spanning three days would appear three times.
  const totalSessions = filtered.length

  // Totals cover the selected period, not each matching session's lifetime.
  const inRange = totalsInRange(filtered, fromKey, toKey, includeUndated)
  const totalMessages = inRange.messages
  const totalTokens = inRange.tokens
  const totalCacheTokens = inRange.cacheTokens
  const totalCost = inRange.cost
  const unpricedResponses = inRange.unpricedResponses
  const incompleteUsageResponses = inRange.incompleteUsageResponses
  const responsesWithoutCompletionSignal = inRange.responsesWithoutCompletionSignal
  const reducedConfidenceResponses = inRange.reducedConfidenceResponses

  // Zero-fill every calendar day in a BOUNDED range — `today`/`7d`/`30d`/
  // custom — so an idle day (most visibly today, early in it) shows up as an
  // explicit zero row instead of silently vanishing from the axis. This is
  // the fix for "7d shows 6 days": `resolveDateRange('7d')` already resolves
  // to exactly 7 keys, but `buildDailyUsage` only ever emits a row for a day
  // that HAD activity (see its own doc comment).
  //
  // `observedDailyUsage` is already scoped to the FULL, unclamped
  // `[fromKey, toKey]` (via `daysInRange`, using the real `toKey` — not
  // `zeroFillTo`), so a genuinely future-dated day within the selected range
  // is already in it before the fill ever runs. `zeroFillDailySeries` only
  // ADDS zero rows up to `zeroFillTo`; it never drops that future day, so it
  // survives into `dailyUsage` right where a plain sum over the series
  // expects it — see the gate's own comment above for why the clamp cannot
  // be allowed to silently discard observed data.
  //
  // `zeroFillDailySeries` never manufactures `UNDATED_DAY` itself (its fill
  // keys come from `dateKeysInRange`, which only emits real calendar days),
  // and `observedDailyUsage` never contains it here regardless (`includeUndated`
  // is false for every bounded preset), so there is no `UNDATED_DAY` entry for
  // the fill to either drop or preserve.
  //
  // Zero rows add nothing to any sum, and `computeCacheAnalytics`'s
  // `dailyHitRatio` (built from this same `dailyUsage`, below) already
  // filters out zero-denominator days, so it continues to show only days
  // with real cache-relevant activity.
  const observedDailyUsage = buildDailyUsage(filtered, fromKey, toKey, includeUndated)
  const dailyUsage = shouldZeroFill
    ? zeroFillDailySeries(observedDailyUsage, from, zeroFillTo, zeroDailyUsage)
    : observedDailyUsage
  const projectCosts = buildProjectCosts(filtered, projects, fromKey, toKey, includeUndated)
  const modelUsage = buildModelUsage(filtered, fromKey, toKey, includeUndated)
  const cacheAnalytics = computeCacheAnalytics(
    filtered,
    dailyUsage,
    pricingTable,
    fromKey,
    toKey,
    includeUndated
  )
  const modelEfficiency = computeModelEfficiency(filtered, fromKey, toKey, includeUndated)
  // The rows themselves are NOT zero-filled here, unlike `dailyUsage` and
  // `effortOverTime` below. Those are one row per day, so an idle day has
  // one obvious zero shape. This is one row per (day, model) pair — an idle
  // day has no "model" to hang a zero-cost row off, and inventing one (an
  // empty model id, or reusing `'unknown'`) would inject a fabricated model
  // into every consumer that reads this list, including the chart's own
  // legend, on any range with even one idle day. Left as observed-(day,
  // model)-pairs only, matching this file's other composite-keyed series
  // (`modelUsage`).
  //
  // The chart still needs to agree with `dailyUsage` on how many days the
  // range has (see `DailyModelCostChart`'s `dateKeys` prop, wired in
  // `models-tab.tsx` from this same `dailyUsage`): the DATE axis is filled
  // at the chart boundary, where a missing day can honestly become "no bars
  // that day" without inventing a model to own them; the MODEL dimension is
  // never touched.
  const dailyModelCost = computeDailyModelCost(filtered, fromKey, toKey, includeUndated)
  // No `includeUndated` here, unlike every sibling call above/below — this is
  // the one aggregate that keeps undated turns excluded even under `all`. See
  // `computeLatencyAnalytics`'s doc comment for the reasoning.
  const latencyAnalytics = computeLatencyAnalytics(filtered, projects, fromKey, toKey)
  const effortAnalyticsRaw = computeEffortAnalytics(filtered, fromKey, toKey, includeUndated)
  // Same zero-fill, same gate, as `dailyUsage` above: `effortOverTime` is
  // one row per day (a per-level distribution, not per-model), so it zero-
  // fills cleanly the same way. `EffortOverTimeChart` defaults every level to
  // 0 already (`d.distribution.low ?? 0`, etc.), so an all-zero distribution
  // renders as an empty stacked bar for that day rather than no bar at all.
  const effortAnalytics: EffortAnalytics = shouldZeroFill
    ? {
        ...effortAnalyticsRaw,
        effortOverTime: zeroFillDailySeries(
          effortAnalyticsRaw.effortOverTime,
          from,
          zeroFillTo,
          (date) => ({
            id: date,
            date,
            distribution: { low: 0, medium: 0, high: 0, ultrathink: 0 },
          })
        ),
      }
    : effortAnalyticsRaw
  const parallelToolAnalytics = computeParallelToolAnalytics(
    filtered,
    fromKey,
    toKey,
    includeUndated
  )
  const sessionHealthSummaryRaw = computeSessionHealthSummary(
    filtered,
    fromKey,
    toKey,
    includeUndated
  )
  // Same zero-fill, same gate, as `dailyUsage`/`effortOverTime` above.
  // `dailyHealthTrend` is drawn as `<Line type="monotone">` in
  // `HealthTrendChart` (insights-tab.tsx) — a line chart interpolates
  // BETWEEN its points, so two real days three idle days apart used to draw
  // a smooth, plausible-looking slope straight across days that had no
  // sessions at all. That is worse than a missing bar: a missing point is
  // visibly absent, an interpolated one looks like data. Zero-filling gives
  // every idle day its own `{ clean: 0, flagged: 0 }` point, so the line
  // correctly flattens to zero on those days instead of inventing a trend
  // through them.
  const sessionHealthSummary: SessionHealthSummary = shouldZeroFill
    ? {
        ...sessionHealthSummaryRaw,
        dailyHealthTrend: zeroFillDailySeries(
          sessionHealthSummaryRaw.dailyHealthTrend,
          from,
          zeroFillTo,
          (date) => ({ date, clean: 0, flagged: 0 })
        ),
      }
    : sessionHealthSummaryRaw
  const sessionRows = buildSessionPeriodRows(filtered, fromKey, toKey, includeUndated)

  // Reported regardless of `includeUndated`: a calendar-scoped range excludes
  // this activity from every total above but must still disclose that it
  // exists, and `all` both includes it above AND discloses it here — see
  // `undatedActivityTotals`'s own doc comment for why this reads from the
  // unfiltered `sessions`, not `filtered`.
  const undated = undatedActivityTotals(sessions)
  const undatedActivity: AnalyticsData['undatedActivity'] = {
    messages: undated.messages,
    responses: undated.responses,
    includedInTotals: includeUndated,
  }

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    totalCacheTokens,
    totalCost,
    unpricedResponses,
    incompleteUsageResponses,
    responsesWithoutCompletionSignal,
    reducedConfidenceResponses,
    dailyUsage,
    projectCosts,
    modelUsage,
    cacheAnalytics,
    modelEfficiency,
    dailyModelCost,
    latencyAnalytics,
    effortAnalytics,
    parallelToolAnalytics,
    sessionHealthSummary,
    sessionRows,
    undatedActivity,
  }
}
