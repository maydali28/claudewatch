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
    unpricedResponses: 0,
    incompleteUsageResponses: 0,
    responsesWithoutCompletionSignal: 0,
    reducedConfidenceResponses: 0,
    responseCount: 1,
    parentMessageCount: 1,
    childMessageCount: 0,
    messageCount: 1,
    parentEstimatedCost: 0,
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
    estimatedCost: 0,
    hasError: false,
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
    diagnostics: {
      malformedLines: 0,
      unreadableChildren: 0,
      negativeCounters: 0,
      conflictCount: 0,
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    },
    thinkingTokens: 0,
    recordedEffortDistribution: {},
    serviceTiers: [],
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

  /**
   * The two undated sub-cases — no timestamp at all, and a present-but-
   * unparsable one — are now handled the same way, which is what
   * `computeLatencyAnalytics`'s doc comment always claimed and the code
   * implemented in reverse.
   *
   * It used to wrap the day check in `if (td.assistantTimestamp)`, so a
   * timestamp-less turn skipped the range filter entirely and was counted in
   * EVERY calendar range including `today` — attributing a duration to a day
   * nothing said it happened on. A turn with a malformed timestamp, meanwhile,
   * was excluded. Both now route through `toDayKeyOrUndated` to `UNDATED_DAY`,
   * which sorts below every real day key, so neither is charged to a calendar
   * window it cannot honestly claim.
   *
   * Constructed as a fixture on purpose: `judgeResponse` cannot emit either
   * shape (pinned in `response-observability.test.ts`), so this documents the
   * policy for a state only a hand-built or corrupted summary can reach.
   */
  it('excludes a turn with no timestamp from a calendar range, like a malformed one', () => {
    const undated = session('undated', [day({ day: ON_9TH })], {
      turnDurations: [turn(undefined, 5_000)],
    })
    const malformed = session('malformed', [day({ day: ON_9TH })], {
      turnDurations: [turn('invalid', 5_000)],
    })

    const undatedCount = computeAnalytics(
      [undated],
      [],
      custom(ON_9TH, ON_9TH),
      ANTHROPIC_PRICING
    ).latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)
    const malformedCount = computeAnalytics(
      [malformed],
      [],
      custom(ON_9TH, ON_9TH),
      ANTHROPIC_PRICING
    ).latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)

    expect(undatedCount).toBe(0)
    expect(malformedCount).toBe(0)
    // Symmetry is the assertion, not the individual zeros: whatever the
    // policy, the two undated sub-cases must not disagree.
    expect(undatedCount).toBe(malformedCount)
  })

  /**
   * The accepted ruling that latency stays excluded for undated turns even
   * under `all`, where every sibling aggregate folds the undated bucket back
   * in. Pinned here rather than left to a comment — and it now applies to the
   * timestamp-less case too, which previously escaped it.
   */
  it('keeps an undated turn out of latency even under the all-time preset', () => {
    const undated = session('undated-all', [day({ day: ON_9TH })], {
      turnDurations: [turn(undefined, 5_000), turn('invalid', 7_000)],
    })
    const a = computeAnalytics([undated], [], 'all', ANTHROPIC_PRICING)
    expect(a.latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)).toBe(0)
    expect(a.latencyAnalytics.slowestTurns).toEqual([])
  })

  it('lists a slow turn only under the day it happened', () => {
    const a = computeAnalytics([SLOW_THEN_FAST], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)
    expect(a.latencyAnalytics.slowestTurns.every((t) => t.durationMs !== 60_000)).toBe(true)
  })
})

/**
 * Effort is judged once per API response (Task 5's `flushPendingResponse`),
 * and every response carries its own timestamp, so its distribution belongs
 * to the day it happened on — not to any day a merely-active session touches.
 */
describe('effort is scoped to the period', () => {
  it('excludes a session that was not active in the range', () => {
    const a = computeAnalytics(
      [
        session('a', [
          day({ day: ON_8TH, effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 } }),
        ]),
      ],
      [],
      custom('2026-09-01', '2026-09-02'),
      ANTHROPIC_PRICING
    )
    const total = Object.values(a.effortAnalytics.distribution).reduce((s, n) => s + n, 0)
    expect(total).toBe(0)
  })

  it('reports only the effort spent inside the selected period', () => {
    // One ultrathink response on 8 September, one low response on 9 September.
    // `observability.effortDistribution` carries the same union a real parsed
    // session would (both days combined) — set explicitly, rather than left at
    // the helper's unrelated default, so a naive lifetime-sum implementation
    // provably disagrees with the per-day answer instead of matching it by
    // fixture coincidence.
    const s = session(
      'effort-split',
      [
        day({
          day: ON_8TH,
          effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 1 },
          parentEstimatedCost: 10,
        }),
        day({
          day: ON_9TH,
          effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 },
          parentEstimatedCost: 1,
        }),
      ],
      {
        observability: {
          dominantEffortLevel: 'ultrathink',
          effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 1 },
          errorClassifications: [],
          hasIdleZombieGap: false,
          estimatedIdleWasteCost: 0,
          compactionTimestamps: [],
          parallelToolCallCount: 0,
          maxParallelDegree: 0,
          isWorktreeSession: false,
        },
      }
    )

    const a = computeAnalytics([s], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)

    expect(a.effortAnalytics.distribution.ultrathink).toBe(0)
    expect(a.effortAnalytics.distribution.low).toBe(1)
  })

  it('includes both days’ effort across a range covering both', () => {
    const s = session(
      'effort-both',
      [
        day({ day: ON_8TH, effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 1 } }),
        day({ day: ON_9TH, effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 } }),
      ],
      {
        observability: {
          dominantEffortLevel: 'ultrathink',
          effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 1 },
          errorClassifications: [],
          hasIdleZombieGap: false,
          estimatedIdleWasteCost: 0,
          compactionTimestamps: [],
          parallelToolCallCount: 0,
          maxParallelDegree: 0,
          isWorktreeSession: false,
        },
      }
    )

    const a = computeAnalytics([s], [], custom(ON_8TH, ON_9TH), ANTHROPIC_PRICING)

    expect(a.effortAnalytics.distribution.ultrathink).toBe(1)
    expect(a.effortAnalytics.distribution.low).toBe(1)
  })

  it('buckets effortOverTime by the day each response actually occurred, not the session’s lastTimestamp', () => {
    // lastTimestamp lands on the 9th (session()'s convention), but the
    // ultrathink response happened on the 8th. A bucketing scheme keyed off
    // lastTimestamp would fold both days' votes onto the 9th and leave the
    // 8th missing entirely from the series.
    const s = session(
      'effort-over-time',
      [
        day({ day: ON_8TH, effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 1 } }),
        day({ day: ON_9TH, effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 } }),
      ],
      {
        observability: {
          dominantEffortLevel: 'ultrathink',
          effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 1 },
          errorClassifications: [],
          hasIdleZombieGap: false,
          estimatedIdleWasteCost: 0,
          compactionTimestamps: [],
          parallelToolCallCount: 0,
          maxParallelDegree: 0,
          isWorktreeSession: false,
        },
      }
    )

    const a = computeAnalytics([s], [], custom(ON_8TH, ON_9TH), ANTHROPIC_PRICING)

    const day8 = a.effortAnalytics.effortOverTime.find((e) => e.date === ON_8TH)
    const day9 = a.effortAnalytics.effortOverTime.find((e) => e.date === ON_9TH)

    expect(day8?.distribution).toEqual({ low: 0, medium: 0, high: 0, ultrathink: 1 })
    expect(day9?.distribution).toEqual({ low: 1, medium: 0, high: 0, ultrathink: 0 })
  })
})

/**
 * Parallel-tool groups are judged per response and land on the day that
 * response was flushed on, same as effort — see `flushPendingResponse`.
 */
describe('parallel-tool analytics are scoped to the period', () => {
  it('excludes parallel groups from a day outside the selected period', () => {
    // Lifetime `observability` set to the same union a real parsed session
    // would carry (both days combined), so a lifetime-summing implementation
    // provably disagrees with the single-day answer instead of matching it by
    // fixture coincidence (both defaulted to zero).
    const s = session(
      'parallel-split',
      [
        day({ day: ON_8TH, parallelToolGroups: 3, maxParallelDegree: 4 }),
        day({ day: ON_9TH, parallelToolGroups: 0, maxParallelDegree: 0 }),
      ],
      {
        observability: {
          dominantEffortLevel: 'low',
          effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 },
          errorClassifications: [],
          hasIdleZombieGap: false,
          estimatedIdleWasteCost: 0,
          compactionTimestamps: [],
          parallelToolCallCount: 3,
          maxParallelDegree: 4,
          isWorktreeSession: false,
        },
      }
    )

    const a = computeAnalytics([s], [], custom(ON_9TH, ON_9TH), ANTHROPIC_PRICING)

    expect(a.parallelToolAnalytics.totalParallelGroups).toBe(0)
  })

  it('reports maxParallelDegree as the max across days in range, not the last day or a sum', () => {
    // A day outside the queried range (the 7th) carries the largest degree of
    // all — it must not leak in, and the two in-range days must not be summed
    // or collapsed to whichever is last.
    const s = session(
      'parallel-max',
      [
        day({ day: '2026-09-07', parallelToolGroups: 5, maxParallelDegree: 20 }),
        day({ day: ON_8TH, parallelToolGroups: 2, maxParallelDegree: 9 }),
        day({ day: ON_9TH, parallelToolGroups: 1, maxParallelDegree: 3 }),
      ],
      {
        observability: {
          dominantEffortLevel: 'low',
          effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 },
          errorClassifications: [],
          hasIdleZombieGap: false,
          estimatedIdleWasteCost: 0,
          compactionTimestamps: [],
          parallelToolCallCount: 8,
          maxParallelDegree: 20,
          isWorktreeSession: false,
        },
      }
    )

    const a = computeAnalytics([s], [], custom(ON_8TH, ON_9TH), ANTHROPIC_PRICING)

    // Not the 7th's 20 (outside the range), not the last day's 3, and not the
    // in-range sum 9 + 3 = 12.
    expect(a.parallelToolAnalytics.maxParallelDegree).toBe(9)
    expect(a.parallelToolAnalytics.totalParallelGroups).toBe(3)
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
