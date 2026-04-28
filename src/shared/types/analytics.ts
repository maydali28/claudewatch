import type { EffortLevel, EffortDistribution } from './session'
import type { LintCheckId, LintSeverity } from './lint'

// ─── Daily Usage ──────────────────────────────────────────────────────────────

export interface DailyUsage {
  id: string // YYYY-MM-DD
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  sessionCount: number
  messageCount: number
  estimatedCost: number
}

// ─── Project Cost ─────────────────────────────────────────────────────────────

export interface ProjectCost {
  id: string // projectId
  projectId: string
  projectName: string
  totalCost: number
  totalTokens: number
  sessionCount: number
  messageCount: number
}

// ─── Model Usage ──────────────────────────────────────────────────────────────

export interface ModelUsage {
  id: string // model family
  model: string
  turnCount: number
  totalInputTokens: number
  totalOutputTokens: number
}

// ─── Cache Analytics ──────────────────────────────────────────────────────────

export interface SessionCacheEfficiency {
  id: string
  sessionId: string
  sessionTitle: string
  hitRatio: number
  cacheReadTokens: number
  cacheWriteTokens: number
  savingsAmount: number
  primaryModel?: string
}

export interface ModelCacheSavings {
  id: string // model family
  model: string
  cacheReadTokens: number
  savingsPerMTok: number
  totalSavings: number
}

export interface DailyHitRatio {
  id: string // date
  date: string
  ratio: number
}

export interface SessionCompactionEntry {
  id: string // sessionId
  sessionTitle: string
  compactionCount: number
  totalTokensRemoved: number
  peakContextTokens: number
  estimatedCostAvoided: number
  primaryModel?: string
}

export interface CompactionAnalytics {
  totalCompactions: number
  totalTokensRemoved: number
  avgTokensRemovedPerSession: number
  estimatedCostAvoided: number
  topSessions: SessionCompactionEntry[]
}

export interface CacheAnalytics {
  hitRatio: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  costSavings: number
  hypotheticalUncachedCost: number
  actualCost: number
  averageReuseRate: number
  dailyHitRatio: DailyHitRatio[]
  totalCache5mTokens: number
  totalCache1hTokens: number
  tierCostBreakdown: { cost5m: number; cost1h: number }
  sessionEfficiency: SessionCacheEfficiency[]
  modelSavings: ModelCacheSavings[]
  cacheBustingDays: string[]
  compactionAnalytics: CompactionAnalytics
}

// ─── Model Efficiency ─────────────────────────────────────────────────────────

export interface ModelEfficiencyRow {
  id: string // model family
  model: string
  turnCount: number
  totalOutputTokens: number
  avgOutputPerTurn: number
  totalCost: number
  costPerTurn: number
  percentOfTotalCost: number
}

export interface DailyModelCost {
  id: string // `${date}-${model}`
  date: string
  model: string
  cost: number
}

// ─── Latency Analytics ────────────────────────────────────────────────────────

export interface LatencyBucket {
  id: string // label
  label: string
  count: number
}

export interface SlowTurnEntry {
  id: string
  sessionId: string
  projectId: string
  sessionTitle: string
  turnIndex: number
  durationMs: number
  isPostCompaction: boolean
  model?: string
}

export interface LatencyAnalytics {
  medianDurationMs: number
  p95DurationMs: number
  p99DurationMs: number
  histogram: LatencyBucket[]
  slowestTurns: SlowTurnEntry[]
  postCompactionAvgMs: number
  normalAvgMs: number
  degradingSessionIds: string[]
}

// ─── Effort Analytics ─────────────────────────────────────────────────────────

export interface EffortCostBreakdown {
  id: string // effort level
  level: EffortLevel
  turnCount: number
  totalCost: number
  avgCostPerTurn: number
}

export interface DailyEffort {
  id: string // date
  date: string
  distribution: EffortDistribution
}

export interface EffortAnalytics {
  distribution: EffortDistribution
  costByEffort: EffortCostBreakdown[]
  effortOverTime: DailyEffort[]
}

// ─── Parallel Tool Analytics ──────────────────────────────────────────────────

export interface ParallelToolBucket {
  id: number // toolCount
  toolCount: number
  occurrences: number
}

export interface ParallelToolAnalytics {
  totalParallelGroups: number
  avgToolsPerGroup: number
  maxParallelDegree: number
  distribution: ParallelToolBucket[]
}

// ─── Top-level AnalyticsData ──────────────────────────────────────────────────

export interface AnalyticsData {
  totalSessions: number
  totalMessages: number
  totalTokens: number
  totalCacheTokens: number
  totalCost: number
  dailyUsage: DailyUsage[]
  projectCosts: ProjectCost[]
  modelUsage: ModelUsage[]
  cacheAnalytics: CacheAnalytics
  modelEfficiency: ModelEfficiencyRow[]
  dailyModelCost: DailyModelCost[]
  latencyAnalytics: LatencyAnalytics
  effortAnalytics: EffortAnalytics
  parallelToolAnalytics: ParallelToolAnalytics
  sessionHealthSummary: SessionHealthSummary
}

// ─── Session Health ───────────────────────────────────────────────────────────

export interface SessionHealthEntry {
  sessionId: string
  sessionTitle: string
  projectId: string
  flags: LintCheckId[]
  worstSeverity: LintSeverity
  estimatedCost: number
  lastTimestamp: string
}

export interface SessionHealthSummary {
  cleanCount: number
  warningCount: number
  errorCount: number
  topUnhealthy: SessionHealthEntry[]
  dailyHealthTrend: { date: string; clean: number; flagged: number }[]
}

// ─── Date Range ───────────────────────────────────────────────────────────────

export type DateRangePreset = 'today' | '7d' | '30d' | '90d' | 'all'

export interface CustomDateRange {
  preset: 'custom'
  from: string // ISO date string
  to: string // ISO date string
}

export type DateRange = DateRangePreset | CustomDateRange
