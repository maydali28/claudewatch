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
} from '@shared/types/analytics'
import type { LintCheckId, LintSeverity } from '@shared/types/lint'
import { getModelFamily } from '@shared/constants/models'

import { resolveDateRange, toDateKey, isWithinRange } from '@shared/utils/date-ranges'

// ─── Internal helpers ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

function filterByDateRange(sessions: SessionSummary[], from: Date, to: Date): SessionSummary[] {
  return sessions.filter((s) => isWithinRange(s.lastTimestamp, from, to))
}

// ─── buildDailyUsage ─────────────────────────────────────────────────────────

function buildDailyUsage(sessions: SessionSummary[]): DailyUsage[] {
  const byDate = new Map<string, DailyUsage>()

  for (const s of sessions) {
    const key = toDateKey(s.lastTimestamp)
    const existing = byDate.get(key)
    if (existing) {
      existing.inputTokens += s.totalInputTokens
      existing.outputTokens += s.totalOutputTokens
      existing.cacheReadTokens += s.totalCacheReadTokens
      existing.cacheCreationTokens += s.totalCacheCreationTokens
      existing.cacheCreation5mTokens += s.totalCacheCreation5mTokens
      existing.cacheCreation1hTokens += s.totalCacheCreation1hTokens
      existing.sessionCount++
      existing.messageCount += s.messageCount
      existing.estimatedCost += s.estimatedCost
    } else {
      byDate.set(key, {
        id: key,
        date: key,
        inputTokens: s.totalInputTokens,
        outputTokens: s.totalOutputTokens,
        cacheReadTokens: s.totalCacheReadTokens,
        cacheCreationTokens: s.totalCacheCreationTokens,
        cacheCreation5mTokens: s.totalCacheCreation5mTokens,
        cacheCreation1hTokens: s.totalCacheCreation1hTokens,
        sessionCount: 1,
        messageCount: s.messageCount,
        estimatedCost: s.estimatedCost,
      })
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ─── buildProjectCosts ────────────────────────────────────────────────────────

function buildProjectCosts(sessions: SessionSummary[], projects: Project[]): ProjectCost[] {
  const byProject = new Map<string, ProjectCost>()

  const projectMap = new Map(projects.map((p) => [p.id, p]))

  for (const s of sessions) {
    const existing = byProject.get(s.projectId)
    const projectName = projectMap.get(s.projectId)?.name ?? s.projectId
    if (existing) {
      existing.totalCost += s.estimatedCost
      existing.totalTokens += s.totalInputTokens + s.totalOutputTokens
      existing.sessionCount++
      existing.messageCount += s.messageCount
    } else {
      byProject.set(s.projectId, {
        id: s.projectId,
        projectId: s.projectId,
        projectName,
        totalCost: s.estimatedCost,
        totalTokens: s.totalInputTokens + s.totalOutputTokens,
        sessionCount: 1,
        messageCount: s.messageCount,
      })
    }
  }

  return [...byProject.values()].sort((a, b) => b.totalCost - a.totalCost)
}

// ─── buildModelUsage ──────────────────────────────────────────────────────────

function buildModelUsage(sessions: SessionSummary[]): ModelUsage[] {
  const byFamily = new Map<string, ModelUsage>()

  for (const s of sessions) {
    for (const bd of s.modelBreakdown) {
      const family = getModelFamily(bd.model)
      if (family === 'unknown') continue
      const existing = byFamily.get(family)
      if (existing) {
        existing.turnCount += bd.turnCount
        existing.totalInputTokens += bd.inputTokens
        existing.totalOutputTokens += bd.outputTokens
      } else {
        byFamily.set(family, {
          id: family,
          model: family,
          turnCount: bd.turnCount,
          totalInputTokens: bd.inputTokens,
          totalOutputTokens: bd.outputTokens,
        })
      }
    }
  }

  return [...byFamily.values()].sort((a, b) => b.turnCount - a.turnCount)
}

// ─── computeCacheAnalytics ────────────────────────────────────────────────────

function computeCacheAnalytics(
  sessions: SessionSummary[],
  dailyUsage: DailyUsage[],
  pricingTable: Record<ModelFamily, ModelPricing>
): CacheAnalytics {
  let totalCacheReadTokens = 0
  let totalCacheWriteTokens = 0
  let totalCache5mTokens = 0
  let totalCache1hTokens = 0

  for (const s of sessions) {
    totalCacheReadTokens += s.totalCacheReadTokens
    totalCacheWriteTokens += s.totalCacheCreationTokens
    totalCache5mTokens += s.totalCacheCreation5mTokens
    totalCache1hTokens += s.totalCacheCreation1hTokens
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
  const totalFreshInputTokens = sessions.reduce((s, sess) => s + sess.totalInputTokens, 0)
  const hitRatioDenominator = totalFreshInputTokens + totalCacheReadTokens + totalCacheWriteTokens
  const hitRatio = hitRatioDenominator > 0 ? totalCacheReadTokens / hitRatioDenominator : 0

  // Hypothetical uncached cost vs actual
  // Cost savings = what we saved by reading from cache instead of paying full input price
  // Approximate: savings = cache_read_tokens * (avg_input_rate - cache_read_rate)
  // Use sonnet as a proxy for average
  const sonnetPricing = pricingTable['sonnet-4-6'] ?? pricingTable['unknown']
  const savingsPerMTok = sonnetPricing.input - sonnetPricing.cacheRead
  const costSavings = (totalCacheReadTokens / 1_000_000) * savingsPerMTok

  const actualCost = sessions.reduce((s, sess) => s + sess.estimatedCost, 0)
  const hypotheticalUncachedCost = actualCost + costSavings

  // Average reuse rate: how many times each cache write was reused on average
  const averageReuseRate =
    totalCacheWriteTokens > 0 ? totalCacheReadTokens / totalCacheWriteTokens : 0

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

  // Cache-busting days: days where ratio dropped significantly vs prior day
  const cacheBustingDays: string[] = []
  for (let i = 1; i < dailyHitRatio.length; i++) {
    const prev = dailyHitRatio[i - 1].ratio
    const curr = dailyHitRatio[i].ratio
    if (prev > 0.3 && curr < 0.1) {
      cacheBustingDays.push(dailyHitRatio[i].date)
    }
  }

  // Per-session efficiency — same formula: read / (input + read + creation)
  const sessionEfficiency: SessionCacheEfficiency[] = sessions
    .filter((s) => s.totalCacheReadTokens + s.totalCacheCreationTokens > 0)
    .map((s) => {
      const denominator = s.totalInputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens
      const hitR = denominator > 0 ? s.totalCacheReadTokens / denominator : 0
      const family = getModelFamily(s.primaryModel)
      const p = pricingTable[family] ?? pricingTable['unknown']
      const savings = (s.totalCacheReadTokens / 1_000_000) * (p.input - p.cacheRead)
      return {
        id: s.id,
        sessionId: s.id,
        sessionTitle: s.title,
        hitRatio: hitR,
        cacheReadTokens: s.totalCacheReadTokens,
        cacheWriteTokens: s.totalCacheCreationTokens,
        savingsAmount: savings,
        primaryModel: s.primaryModel,
      }
    })
    .sort((a, b) => b.cacheReadTokens - a.cacheReadTokens)
    .slice(0, 20)

  // Model savings breakdown
  const modelSavingsMap = new Map<string, ModelCacheSavings>()
  for (const s of sessions) {
    for (const bd of s.modelBreakdown) {
      const family = getModelFamily(bd.model)
      const p = pricingTable[family] ?? pricingTable['unknown']
      const savings = (bd.cacheReadTokens / 1_000_000) * (p.input - p.cacheRead)
      const existing = modelSavingsMap.get(family)
      if (existing) {
        existing.cacheReadTokens += bd.cacheReadTokens
        existing.totalSavings += savings
      } else {
        modelSavingsMap.set(family, {
          id: family,
          model: family,
          cacheReadTokens: bd.cacheReadTokens,
          savingsPerMTok: p.input - p.cacheRead,
          totalSavings: savings,
        })
      }
    }
  }

  // Tier cost breakdown
  const cost5m = sessions.reduce((s, sess) => {
    const family = getModelFamily(sess.primaryModel)
    const p = pricingTable[family] ?? pricingTable['unknown']
    return s + (sess.totalCacheCreation5mTokens / 1_000_000) * p.cache5m
  }, 0)
  const cost1h = sessions.reduce((s, sess) => {
    const family = getModelFamily(sess.primaryModel)
    const p = pricingTable[family] ?? pricingTable['unknown']
    return s + (sess.totalCacheCreation1hTokens / 1_000_000) * p.cache1h
  }, 0)

  // Compaction analytics
  const compactionSessions = sessions.filter((s) => s.compactionCount > 0)
  const totalCompactions = compactionSessions.reduce((s, sess) => s + sess.compactionCount, 0)
  const totalTokensRemoved = sessions.reduce(
    (s, sess) => s + (sess.totalTokensRemovedByCompaction ?? 0),
    0
  )
  const avgTokensRemovedPerSession =
    compactionSessions.length > 0 ? totalTokensRemoved / compactionSessions.length : 0

  const topCompactionSessions: SessionCompactionEntry[] = compactionSessions
    .map((s): SessionCompactionEntry => {
      const family = getModelFamily(s.primaryModel)
      const p = pricingTable[family] ?? pricingTable['unknown']
      const removed = s.totalTokensRemovedByCompaction ?? 0
      return {
        id: s.id,
        sessionTitle: s.title,
        compactionCount: s.compactionCount,
        totalTokensRemoved: removed,
        peakContextTokens: removed > 0 ? Math.round(removed / s.compactionCount) : 0,
        estimatedCostAvoided: (removed / 1_000_000) * p.input,
        primaryModel: s.primaryModel,
      }
    })
    .sort((a, b) => b.totalTokensRemoved - a.totalTokensRemoved)
    .slice(0, 15)

  const estimatedCostAvoided =
    topCompactionSessions.reduce((s, e) => s + e.estimatedCostAvoided, 0) +
    compactionSessions
      .filter((_, i) => i >= 15)
      .reduce((s, sess) => {
        const family = getModelFamily(sess.primaryModel)
        const p = pricingTable[family] ?? pricingTable['unknown']
        return s + ((sess.totalTokensRemovedByCompaction ?? 0) / 1_000_000) * p.input
      }, 0)

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
    costSavings,
    hypotheticalUncachedCost,
    actualCost,
    averageReuseRate,
    dailyHitRatio,
    totalCache5mTokens,
    totalCache1hTokens,
    tierCostBreakdown: { cost5m, cost1h },
    sessionEfficiency,
    modelSavings: [...modelSavingsMap.values()],
    cacheBustingDays,
    compactionAnalytics,
  }
}

// ─── computeModelEfficiency ───────────────────────────────────────────────────

function computeModelEfficiency(
  sessions: SessionSummary[],
  _pricingTable: Record<ModelFamily, ModelPricing>
): ModelEfficiencyRow[] {
  const byFamily = new Map<
    string,
    {
      turnCount: number
      totalOutputTokens: number
      totalCost: number
    }
  >()

  for (const s of sessions) {
    for (const bd of s.modelBreakdown) {
      const family = getModelFamily(bd.model)
      const existing = byFamily.get(family)
      if (existing) {
        existing.turnCount += bd.turnCount
        existing.totalOutputTokens += bd.outputTokens
        existing.totalCost += bd.estimatedCost
      } else {
        byFamily.set(family, {
          turnCount: bd.turnCount,
          totalOutputTokens: bd.outputTokens,
          totalCost: bd.estimatedCost,
        })
      }
    }
  }

  const totalCost = [...byFamily.values()].reduce((s, e) => s + e.totalCost, 0)

  return [...byFamily.entries()]
    .map(([family, e]) => ({
      id: family,
      model: family,
      turnCount: e.turnCount,
      totalOutputTokens: e.totalOutputTokens,
      avgOutputPerTurn: e.turnCount > 0 ? e.totalOutputTokens / e.turnCount : 0,
      totalCost: e.totalCost,
      costPerTurn: e.turnCount > 0 ? e.totalCost / e.turnCount : 0,
      percentOfTotalCost: totalCost > 0 ? (e.totalCost / totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.totalCost - a.totalCost)
}

// ─── computeDailyModelCost ────────────────────────────────────────────────────

function computeDailyModelCost(sessions: SessionSummary[]): DailyModelCost[] {
  const byDateModel = new Map<string, DailyModelCost>()

  for (const s of sessions) {
    const date = toDateKey(s.lastTimestamp)
    for (const bd of s.modelBreakdown) {
      const family = getModelFamily(bd.model)
      const key = `${date}-${family}`
      const existing = byDateModel.get(key)
      if (existing) {
        existing.cost += bd.estimatedCost
      } else {
        byDateModel.set(key, { id: key, date, model: family, cost: bd.estimatedCost })
      }
    }
  }

  return [...byDateModel.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)
  )
}

// ─── computeLatencyAnalytics ──────────────────────────────────────────────────

function computeLatencyAnalytics(sessions: SessionSummary[]): LatencyAnalytics {
  const allDurations: number[] = []
  const postCompactionDurations: number[] = []
  const normalDurations: number[] = []
  const slowTurnEntries: SlowTurnEntry[] = []

  for (const s of sessions) {
    for (const td of s.turnDurations ?? []) {
      if (td.durationMs <= 0) continue
      allDurations.push(td.durationMs)
      if (td.isPostCompaction) {
        postCompactionDurations.push(td.durationMs)
      } else {
        normalDurations.push(td.durationMs)
      }
      slowTurnEntries.push({
        id: `${s.id}-${td.turnIndex}`,
        sessionId: s.id,
        projectId: s.projectId,
        sessionTitle: s.title,
        turnIndex: td.turnIndex,
        durationMs: td.durationMs,
        isPostCompaction: td.isPostCompaction,
        model: td.model ?? s.primaryModel,
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

  // Degrading sessions: max turn duration > 2× median and median itself is slow
  const degradingSessionIds = sessions
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
    degradingSessionIds,
  }
}

// ─── computeEffortAnalytics ───────────────────────────────────────────────────

function computeEffortAnalytics(
  sessions: SessionSummary[],
  _pricingTable: Record<ModelFamily, ModelPricing>
): EffortAnalytics {
  const totals = { low: 0, medium: 0, high: 0, ultrathink: 0 }
  const costs: Record<EffortLevel, number> = { low: 0, medium: 0, high: 0, ultrathink: 0 }

  for (const s of sessions) {
    const ed = s.observability.effortDistribution
    totals.low += ed.low
    totals.medium += ed.medium
    totals.high += ed.high
    totals.ultrathink += ed.ultrathink

    // Cost attribution: use parent-session-only cost (exclude subagent rollup) so
    // the proportional split stays consistent with the parent effort distribution.
    const subagentCost = s.subagents.reduce((sum, a) => sum + a.estimatedCost, 0)
    const parentCost = s.estimatedCost - subagentCost

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

  // Effort over time by session date
  const byDate = new Map<string, typeof totals>()
  for (const s of sessions) {
    const date = toDateKey(s.lastTimestamp)
    const existing = byDate.get(date) ?? { low: 0, medium: 0, high: 0, ultrathink: 0 }
    const ed = s.observability.effortDistribution
    existing.low += ed.low
    existing.medium += ed.medium
    existing.high += ed.high
    existing.ultrathink += ed.ultrathink
    byDate.set(date, existing)
  }

  const effortOverTime = [...byDate.entries()]
    .map(([date, dist]) => ({ id: date, date, distribution: dist }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return { distribution: totals, costByEffort, effortOverTime }
}

// ─── computeParallelToolAnalytics ─────────────────────────────────────────────

function computeParallelToolAnalytics(sessions: SessionSummary[]): ParallelToolAnalytics {
  let totalParallelGroups = 0
  let maxParallelDegree = 0
  let totalToolsInGroups = 0
  const groupSizeCounts = new Map<number, number>()

  for (const s of sessions) {
    const obs = s.observability
    if (!obs) continue
    totalParallelGroups += obs.parallelToolCallCount
    if (obs.maxParallelDegree > maxParallelDegree) {
      maxParallelDegree = obs.maxParallelDegree
    }
    // We only have counts from observability, not group size distribution
    // Use maxParallelDegree as a proxy for group size distribution from the session
    if (obs.parallelToolCallCount > 0 && obs.maxParallelDegree > 0) {
      totalToolsInGroups += obs.parallelToolCallCount * obs.maxParallelDegree
      const count = groupSizeCounts.get(obs.maxParallelDegree) ?? 0
      groupSizeCounts.set(obs.maxParallelDegree, count + obs.parallelToolCallCount)
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
const SES004_MIN_MESSAGES = 10
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

function computeSessionHealthSummary(sessions: SessionSummary[]): SessionHealthSummary {
  let cleanCount = 0
  let warningCount = 0
  let errorCount = 0
  const unhealthyEntries: SessionHealthEntry[] = []
  const dailyMap = new Map<string, { clean: number; flagged: number }>()

  for (const session of sessions) {
    const dateKey = toDateKey(session.lastTimestamp)
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { clean: 0, flagged: 0 })
    const day = dailyMap.get(dateKey)!

    const flags = evaluateSessionFlags(session)

    if (flags.length === 0) {
      cleanCount++
      day.clean++
    } else {
      const severity = worstSeverityForFlags(flags)
      if (severity === 'error') errorCount++
      else warningCount++
      day.flagged++

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

export function computeAnalytics(
  sessions: SessionSummary[],
  projects: Project[],
  dateRange: DateRange,
  pricingTable: Record<ModelFamily, ModelPricing>
): AnalyticsData {
  const { from, to } = resolveDateRange(dateRange)
  const filtered = filterByDateRange(sessions, from, to)

  const totalSessions = filtered.length
  const totalMessages = filtered.reduce((s, sess) => s + sess.messageCount, 0)
  const totalTokens = filtered.reduce(
    (s, sess) => s + sess.totalInputTokens + sess.totalOutputTokens,
    0
  )
  const totalCacheTokens = filtered.reduce(
    (s, sess) => s + sess.totalCacheReadTokens + sess.totalCacheCreationTokens,
    0
  )
  const totalCost = filtered.reduce((s, sess) => s + sess.estimatedCost, 0)

  const dailyUsage = buildDailyUsage(filtered)
  const projectCosts = buildProjectCosts(filtered, projects)
  const modelUsage = buildModelUsage(filtered)
  const cacheAnalytics = computeCacheAnalytics(filtered, dailyUsage, pricingTable)
  const modelEfficiency = computeModelEfficiency(filtered, pricingTable)
  const dailyModelCost = computeDailyModelCost(filtered)
  const latencyAnalytics = computeLatencyAnalytics(filtered)
  const effortAnalytics = computeEffortAnalytics(filtered, pricingTable)
  const parallelToolAnalytics = computeParallelToolAnalytics(filtered)
  const sessionHealthSummary = computeSessionHealthSummary(filtered)

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    totalCacheTokens,
    totalCost,
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
  }
}
