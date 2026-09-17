import { describe, expect, it } from 'vitest'
import type { SessionSummary, SessionDayUsage } from '@shared/types/session'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { computeAnalytics } from './analytics-engine'

/**
 * Figures shown on the same screen must share a scope.
 *
 * Several domains still read a session's lifetime while the totals beside them
 * cover the selected period, so a narrow range made the parts disagree with the
 * whole they claim to break down.
 */

function day(over: Partial<SessionDayUsage> & { day: string }): SessionDayUsage {
  return {
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheCreationTokens: 0,
    estimatedCost: 1,
    unpricedResponses: 0,
    incompleteUsageResponses: 0,
    responsesWithoutCompletionSignal: 0,
    reducedConfidenceResponses: 0,
    pricingModifierResponses: 0,
    serverToolRequests: 0,
    responseCount: 1,
    parentMessageCount: 1,
    childMessageCount: 0,
    messageCount: 1,
    parentEstimatedCost: 1,
    compactions: 0,
    tokensRemovedByCompaction: 0,
    maxPreCompactionTokens: 0,
    effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 0 },
    parallelToolGroups: 0,
    maxParallelDegree: 0,
    models: [],
    ...over,
  }
}

function session(
  id: string,
  dailyUsage: SessionDayUsage[],
  extra: Partial<SessionSummary> = {}
): SessionSummary {
  return {
    id,
    projectId: 'proj',
    projectPath: '/proj',
    title: id,
    firstTimestamp: `${dailyUsage[0].day}T09:00:00.000Z`,
    lastTimestamp: `${dailyUsage[dailyUsage.length - 1].day}T12:00:00.000Z`,
    messageCount: dailyUsage.length,
    parentMessageCount: dailyUsage.length,
    modelsUsed: [],
    unpricedResponses: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheCreation5mTokens: 0,
    totalCacheCreation1hTokens: 0,
    compactionCount: 0,
    totalTokensRemovedByCompaction: 0,
    turnDurations: [],
    estimatedCost: dailyUsage.reduce((n, d) => n + d.estimatedCost, 0),
    hasError: false,
    toolCallCount: 0,
    observability: {
      dominantEffortLevel: 'high',
      effortDistribution: { low: 0, medium: 0, high: 3, ultrathink: 0 },
      errorClassifications: [],
      hasIdleZombieGap: false,
      estimatedIdleWasteCost: 0,
      compactionTimestamps: [],
      parallelToolCallCount: 0,
      maxParallelDegree: 0,
      isWorktreeSession: false,
    },
    tags: [],
    subagents: [],
    dailyUsage,
    diagnostics: {
      malformedLines: 0,
      unreadableChildren: 0,
      negativeCounters: 0,
      conflictCount: 0,
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
      pricingModifierResponses: 0,
      serverToolRequests: 0,
    },
    thinkingTokens: 0,
    recordedEffortDistribution: {},
    turnOpen: false,
    serviceTiers: [],
    ...extra,
  }
}

const ON_8TH = '2026-09-08'
const ON_9TH = '2026-09-09'
const custom = (from: string, to: string): { preset: 'custom'; from: string; to: string } => ({
  preset: 'custom',
  from,
  to,
})

/** $10 spent on the 8th, $1 on the 9th. */
const TWO_DAYS = session(
  'two-days',
  [
    day({
      day: ON_8TH,
      estimatedCost: 10,
      responseCount: 2,
      compactions: 1,
      tokensRemovedByCompaction: 4_000,
      effortDistribution: { low: 0, medium: 0, high: 2, ultrathink: 0 },
    }),
    day({
      day: ON_9TH,
      estimatedCost: 1,
      responseCount: 1,
      compactions: 1,
      tokensRemovedByCompaction: 1_000,
      effortDistribution: { low: 0, medium: 0, high: 1, ultrathink: 0 },
    }),
  ],
  { compactionCount: 2, totalTokensRemovedByCompaction: 5_000 }
)

describe('cache tab agrees with the overview', () => {
  it('reports the same actual cost', () => {
    const a = computeAnalytics([TWO_DAYS], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.cacheAnalytics.actualCost).toBeCloseTo(a.totalCost, 10)
  })

  /**
   * `hypotheticalUncachedCost === totalCost + costSavings` was the exact
   * identity that hid the cache-write premium inside the "without cache"
   * baseline — an uncached request never pays a cache-write premium, so
   * folding it into the baseline via that formula overstated savings. This
   * fixture's workload (Sonnet 5, 1M one-hour writes + 1M reads) has a
   * baseline that is cheaply verified independently of the formula under
   * test: an uncached request pays ordinary input for every token, i.e.
   * 2,000,000 combined tokens * $2/MTok = $4.00, regardless of what caching
   * cost.
   */
  it('bases the uncached counterfactual on paying input rate for the same token volume', () => {
    const CACHE_WORKLOAD = session('cache-workload', [
      day({
        day: ON_9TH,
        cacheReadTokens: 1_000_000,
        cacheCreation1hTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        estimatedCost: 4.2,
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 1_000_000,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 4.2,
            turnCount: 1,
          },
        ],
      }),
    ])

    const a = computeAnalytics([CACHE_WORKLOAD], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)

    expect(a.cacheAnalytics.uncachedSameWorkloadCost).toBeCloseTo(4.0, 10)
  })
})

describe('models tab agrees with itself', () => {
  const MIXED = session('mixed', [
    day({
      // A day's cost is the sum of its models' costs — both derive from the
      // same responses, so a fixture that disagrees is not a real shape.
      day: ON_8TH,
      estimatedCost: 5,
      models: [
        {
          model: 'claude-opus-5',
          family: 'opus-5',
          inputTokens: 0,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          cacheCreationUnknownTtlTokens: 0,
          estimatedCost: 5,
          turnCount: 4,
        },
      ],
    }),
    day({
      day: ON_9TH,
      estimatedCost: 1,
      models: [
        {
          model: 'claude-sonnet-5',
          family: 'sonnet-5',
          inputTokens: 0,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          cacheCreationUnknownTtlTokens: 0,
          estimatedCost: 1,
          turnCount: 1,
        },
      ],
    }),
  ])

  it('lists only the models used in the period', () => {
    const a = computeAnalytics([MIXED], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.modelEfficiency.map((m) => m.model)).toEqual(['sonnet-5'])
  })

  it('counts the same turns in the efficiency table and the usage chart', () => {
    const a = computeAnalytics([MIXED], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.modelEfficiency.reduce((n, m) => n + m.turnCount, 0)).toBe(
      a.modelUsage.reduce((n, m) => n + m.turnCount, 0)
    )
  })

  it('sums model cost to the period total', () => {
    const a = computeAnalytics([MIXED], [], custom(ON_8TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.modelEfficiency.reduce((n, m) => n + m.totalCost, 0)).toBeCloseTo(a.totalCost, 10)
  })
})

describe('effort tab agrees with the overview', () => {
  it('never attributes more cost than the period holds', () => {
    const a = computeAnalytics([TWO_DAYS], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    const effortCost = a.effortAnalytics.costByEffort.reduce((n: number, e) => n + e.totalCost, 0)
    expect(effortCost).toBeLessThanOrEqual(a.totalCost + 1e-9)
  })
})

describe('compaction is scoped to the period', () => {
  it('counts only compactions inside the range', () => {
    const a = computeAnalytics([TWO_DAYS], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.cacheAnalytics.compactionAnalytics.totalCompactions).toBe(1)
  })

  it('counts tokens removed inside the range', () => {
    const a = computeAnalytics([TWO_DAYS], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.cacheAnalytics.compactionAnalytics.totalTokensRemoved).toBe(1_000)
  })

  it('counts both days across a range covering both', () => {
    const a = computeAnalytics([TWO_DAYS], [], custom(ON_8TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.cacheAnalytics.compactionAnalytics.totalCompactions).toBe(2)
    expect(a.cacheAnalytics.compactionAnalytics.totalTokensRemoved).toBe(5_000)
  })
})
