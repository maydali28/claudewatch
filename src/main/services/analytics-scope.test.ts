import { describe, expect, it } from 'vitest'
import type { SessionSummary, SessionDayUsage, TurnDuration } from '@shared/types/session'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { computeAnalytics } from './analytics-engine'

/**
 * Whether the tabs beyond Overview respect the selected period.
 *
 * Anything carrying its own timestamp belongs to the day it happened on.
 * Counting every turn of any session that was merely *active* in the range puts
 * a fortnight of data behind a one-day selection — the same defect as
 * attributing a session's whole history to its last day.
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
    responseCount: 1,
    messageCount: 1,
    parentEstimatedCost: 0,
    compactions: 0,
    tokensRemovedByCompaction: 0,
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
    estimatedCost: 0,
    hasError: false,
    modelBreakdown: [],
    toolCallCount: 0,
    observability: {
      dominantEffortLevel: 'low',
      effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 },
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
    ...extra,
  }
}

function turn(ts: string | undefined, durationMs: number, index = 0): TurnDuration {
  return {
    turnIndex: index,
    assistantTimestamp: ts,
    durationMs,
    isPostCompaction: false,
    inputTokens: 0,
  }
}

const ON_8TH = '2026-09-08'
const ON_9TH = '2026-09-09'
const custom = (from: string, to: string): { preset: 'custom'; from: string; to: string } => ({
  preset: 'custom',
  from,
  to,
})

const SLOW_THEN_FAST = session('latency', [day({ day: ON_8TH }), day({ day: ON_9TH })], {
  turnDurations: [
    turn('2026-09-08T10:00:00.000Z', 60_000, 0),
    turn('2026-09-09T10:00:00.000Z', 1_000, 1),
  ],
})

describe('latency is scoped to the period', () => {
  it('counts only the turns that happened in the selected day', () => {
    const a = computeAnalytics([SLOW_THEN_FAST], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)).toBe(1)
  })

  it('reports that day’s latency, not the whole session’s', () => {
    const a = computeAnalytics([SLOW_THEN_FAST], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    // The 60s turn belongs to the 8th and must not appear here.
    expect(a.latencyAnalytics.medianDurationMs).toBe(1_000)
  })

  it('counts both turns across a range covering both days', () => {
    const a = computeAnalytics([SLOW_THEN_FAST], [], custom(ON_8TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)).toBe(2)
  })

  it('keeps a turn with no timestamp rather than silently dropping it', () => {
    const undated = session('undated', [day({ day: ON_9TH })], {
      turnDurations: [turn(undefined, 5_000)],
    })
    const a = computeAnalytics([undated], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)).toBe(1)
  })

  it('lists a slow turn only under the day it happened', () => {
    const a = computeAnalytics([SLOW_THEN_FAST], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.latencyAnalytics.slowestTurns.every((t) => t.durationMs !== 60_000)).toBe(true)
  })
})

/**
 * Effort is recorded per session, not per turn, so it cannot be split by day.
 * A session counts once for any period it was active in — the honest behaviour
 * given the data, but it must at least follow the range filter.
 */
describe('effort follows the range filter', () => {
  it('excludes a session that was not active in the range', () => {
    const a = computeAnalytics(
      [session('a', [day({ day: ON_8TH })])],
      [],
      custom('2026-09-01', '2026-09-02'),
      ANTHROPIC_PRICING
    )
    const total = Object.values(a.effortAnalytics.distribution).reduce((s, n) => s + n, 0)
    expect(total).toBe(0)
  })

  it('includes a session that was active in the range', () => {
    const a = computeAnalytics(
      [session('a', [day({ day: ON_8TH })])],
      [],
      custom(ON_8TH, ON_8TH),
      ANTHROPIC_PRICING
    )
    const total = Object.values(a.effortAnalytics.distribution).reduce((s, n) => s + n, 0)
    expect(total).toBeGreaterThan(0)
  })
})

/** Session health drives the Insights tab. It is a session-level verdict. */
describe('session health follows the range filter', () => {
  it('excludes sessions outside the range', () => {
    const a = computeAnalytics(
      [session('a', [day({ day: ON_8TH })], { hasError: true })],
      [],
      custom('2026-09-01', '2026-09-02'),
      ANTHROPIC_PRICING
    )
    const { cleanCount, warningCount, errorCount } = a.sessionHealthSummary
    expect(cleanCount + warningCount + errorCount).toBe(0)
  })

  it('counts each session once, not once per active day', () => {
    const a = computeAnalytics(
      [session('a', [day({ day: ON_8TH }), day({ day: ON_9TH })])],
      [],
      custom(ON_8TH, ON_9TH),
      ANTHROPIC_PRICING
    )
    const { cleanCount, warningCount, errorCount } = a.sessionHealthSummary
    expect(cleanCount + warningCount + errorCount).toBe(1)
  })
})
