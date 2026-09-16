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
  /** Gross read-discount savings only — does not subtract the cache-write premium. */
  totalSavings: number
  /** Savings after the cache-write premium; reconciles with CacheAnalytics.netSavings when summed. */
  netSavings: number
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
  /**
   * Sum of pre-compaction context sizes across this session's events — an
   * observed high-water mark, not a measurement of tokens actually freed. A
   * summary is retained after compaction and the summarisation call itself
   * is billed, so this cannot be read as net tokens removed. UI must label
   * it "Pre-compaction context".
   */
  totalTokensRemoved: number
  peakContextTokens: number
  /**
   * Hypothetical only: prices `totalTokensRemoved` once at this session's
   * dominant model's fresh-input rate, as if that whole context had been
   * re-sent instead of compacted. Ignores the retained summary, the
   * summarisation call's own cost, and any cache reuse the re-sent tokens
   * might have gotten — so it is not a measured saving and must be labelled
   * as an estimate wherever shown.
   */
  estimatedCostAvoided: number
  primaryModel?: string
}

export interface CompactionAnalytics {
  totalCompactions: number
  /** See `SessionCompactionEntry.totalTokensRemoved` — same caveat, summed across sessions. */
  totalTokensRemoved: number
  avgTokensRemovedPerSession: number
  /** See `SessionCompactionEntry.estimatedCostAvoided` — same hypothetical pricing, summed across sessions. */
  estimatedCostAvoided: number
  topSessions: SessionCompactionEntry[]
}

export interface CacheAnalytics {
  hitRatio: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  grossReadSavings: number
  writePremium: number
  netSavings: number
  uncachedSameWorkloadCost: number
  actualCost: number
  averageReuseRate: number | null
  dailyHitRatio: DailyHitRatio[]
  totalCache5mTokens: number
  totalCache1hTokens: number
  /**
   * Cache-write tokens whose TTL split is unknown (a flat counter with no
   * tiers reported). Kept apart from `totalCache5mTokens`/`totalCache1hTokens`
   * so a fallback estimate is never mistaken for a known tier.
   */
  totalCacheUnknownTtlTokens: number
  tierCostBreakdown: {
    cost5m: number
    cost1h: number
    /** Unknown-TTL tokens priced at the 5-minute rate as a fallback estimate. */
    costUnknownTtl: number
  }
  sessionEfficiency: SessionCacheEfficiency[]
  modelSavings: ModelCacheSavings[]
  hitRatioDropDays: string[]
  compactionAnalytics: CompactionAnalytics
  /**
   * Responses in the period whose model could not be priced — same concept
   * as `AnalyticsData.unpricedResponses`, scoped to this tab. Every cache
   * figure above (`netSavings`, `modelSavings`, etc.) silently skips these
   * responses' cache activity rather than guessing a rate, so a `0` savings
   * figure can mean "no cache activity" or "cache activity we can't price" —
   * this count is what lets the UI tell those apart instead of presenting an
   * unknown as a confident zero.
   */
  unpricedResponses: number
  /**
   * Responses in the period whose usage shape was unreadable or self-
   * contradictory — same concept as `SessionDiagnostics.incompleteUsageResponses`,
   * scoped to this tab's range. Cache tokens and cost are still counted; this
   * is "partially observed", not a filter.
   */
  incompleteUsageResponses: number
  /**
   * Responses in the period where no completion signal was ever seen — same
   * concept as `SessionDiagnostics.responsesWithoutCompletionSignal`, scoped
   * to this tab's range. Provenance about the retained output figure, not an
   * error.
   */
  responsesWithoutCompletionSignal: number
  /**
   * Responses in the period with no `message.id`, identified by record uuid
   * instead — same concept as `SessionDiagnostics.reducedConfidenceResponses`,
   * scoped to this tab's range.
   */
  reducedConfidenceResponses: number
}

// ─── Model Efficiency ─────────────────────────────────────────────────────────

export interface ModelEfficiencyRow {
  id: string // model family
  model: string
  turnCount: number
  /** Fresh (non-cache) input tokens. `totalOutputTokens` below is the output pool. */
  inputTokens: number
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  /**
   * Remainder of cache-write tokens with no TTL split reported — see
   * `SessionDayModelUsage.cacheCreationUnknownTtlTokens`. Kept apart from the
   * two known tiers so a what-if projection can price it (at the same
   * 5-minute fallback rate the cache tier display uses) instead of silently
   * dropping it, which understated a same-model projection to $0.
   */
  cacheCreationUnknownTtlTokens: number
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
  /**
   * Lifetime, not period-scoped: a median-versus-max turn-duration comparison
   * is a judgement about a session's whole trajectory and cannot be honestly
   * narrowed to a window. UI should label this "Across each session's full
   * history".
   */
  lifetimeDegradingSessionIds: string[]
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

// ─── Session Period Rows ──────────────────────────────────────────────────────

/**
 * One session's contribution to the selected period, for the Overview tab's
 * session table. Every field is scoped to the range `computeAnalytics` was
 * called with — never the session's lifetime — so the renderer can display
 * these directly instead of re-deriving date membership itself.
 */
export interface SessionPeriodRow {
  id: string // sessionId
  sessionId: string
  projectId: string
  title: string
  hasError: boolean
  /** The session's true last activity — a recency signal, not a period total, so it is not clipped to the range. */
  lastTimestamp: string
  /** Parent-transcript messages within the period. */
  parentMessageCount: number
  /** Parent + subagent messages within the period. */
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  estimatedCost: number
}

// ─── Top-level AnalyticsData ──────────────────────────────────────────────────

export interface AnalyticsData {
  totalSessions: number
  totalMessages: number
  totalTokens: number
  totalCacheTokens: number
  totalCost: number
  /** Responses in the period whose model could not be priced, excluded from `totalCost`. */
  unpricedResponses: number
  /**
   * Responses in the period whose usage shape was unreadable or self-
   * contradictory — see `SessionDiagnostics.incompleteUsageResponses`. Still
   * counted in every total above; "partially observed", not a filter.
   */
  incompleteUsageResponses: number
  /**
   * Responses in the period where no completion signal was ever seen — see
   * `SessionDiagnostics.responsesWithoutCompletionSignal`. Provenance about
   * the retained output figure, not an error.
   */
  responsesWithoutCompletionSignal: number
  /**
   * Responses in the period with no `message.id`, identified by record uuid
   * instead — see `SessionDiagnostics.reducedConfidenceResponses`.
   */
  reducedConfidenceResponses: number
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
  sessionRows: SessionPeriodRow[]
  /**
   * Activity with no parsable timestamp (`UNDATED_DAY` in `date-ranges.ts`),
   * reported regardless of which preset is selected. `messages`/`responses`
   * are the totals across every session's undated bucket, independent of
   * `dateRange` — a calendar-scoped preset (`7d`/`30d`/`90d`/custom) cannot
   * honestly attribute this activity to the window it names, so it is always
   * excluded from every total above for those; `includedInTotals` is `true`
   * only for the `all` preset, the one range for which this activity IS
   * folded into `totalMessages` and every other date-scoped figure above.
   */
  undatedActivity: {
    messages: number
    responses: number
    includedInTotals: boolean
  }
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

export type DateRangePreset = 'today' | '7d' | '30d' | 'all'

export interface CustomDateRange {
  preset: 'custom'
  from: string // ISO date string
  to: string // ISO date string
}

export type DateRange = DateRangePreset | CustomDateRange

// ─── Tray snapshot ────────────────────────────────────────────────────────────

/**
 * Everything the tray popover renders, from one committed scan.
 *
 * The tray previously issued three calls — today's analytics, the week's
 * analytics, and listProjects — and the last of those forced a full discovery
 * scan of every transcript on disk on every open and every 30-second refresh.
 * This returns only the fields the popover shows, computed from the cached
 * scan, and carries a handful of sessions instead of all of them.
 */
export interface TraySnapshotSession {
  id: string
  projectId: string
  projectPath: string
  title: string
  slug?: string
  latestModel?: string
  primaryModel?: string
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  lastTimestamp: string
  /** See `SessionSummary.turnOpen`; the popover re-judges liveness with it. */
  turnOpen: boolean
  hasError: boolean
}

export interface TraySnapshot {
  today: {
    sessionCount: number
    tokenCount: number
    messageCount: number
    cost: number
    projectCount: number
  }
  /** Seven calendar days ending today, quiet days included. */
  weekly: Array<{ date: string; tokens: number; cost: number }>
  activeSessions: TraySnapshotSession[]
  recentSessions: TraySnapshotSession[]
}
