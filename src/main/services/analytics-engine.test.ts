import { describe, expect, it } from 'vitest'
import type { SessionSummary, SessionDayUsage } from '@shared/types/session'
import type { Project } from '@shared/types/project'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import {
  UNDATED_DAY,
  resolveDateRange,
  dateKeysInRange,
  toDateKey,
} from '@shared/utils/date-ranges'
import { computeAnalytics } from './analytics-engine'

/**
 * A session day, as the ledger reports it. Costs are illustrative — the point
 * of these tests is which day and which model usage lands on, not the rates.
 */
function day(over: Partial<SessionDayUsage> & { day: string }): SessionDayUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheCreationTokens: 0,
    estimatedCost: 0,
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

function session(id: string, dailyUsage: SessionDayUsage[]): SessionSummary {
  const sum = (pick: (d: SessionDayUsage) => number): number =>
    dailyUsage.reduce((s, d) => s + pick(d), 0)
  return {
    id,
    projectId: 'proj',
    projectPath: '/proj',
    title: id,
    // Deliberately the LAST day: the defect under test is that everything was
    // attributed here regardless of when it actually happened.
    firstTimestamp: `${dailyUsage[0]?.day ?? '2026-09-08'}T09:00:00.000Z`,
    lastTimestamp: `${dailyUsage[dailyUsage.length - 1]?.day ?? '2026-09-09'}T23:00:00.000Z`,
    messageCount: sum((d) => d.messageCount),
    parentMessageCount: sum((d) => d.messageCount),
    modelsUsed: [...new Set(dailyUsage.flatMap((d) => d.models.map((m) => m.model)))],
    unpricedResponses: 0,
    totalInputTokens: sum((d) => d.inputTokens),
    totalOutputTokens: sum((d) => d.outputTokens),
    totalCacheReadTokens: sum((d) => d.cacheReadTokens),
    totalCacheCreationTokens: sum((d) => d.cacheCreationTokens),
    totalCacheCreation5mTokens: sum((d) => d.cacheCreation5mTokens),
    totalCacheCreation1hTokens: sum((d) => d.cacheCreation1hTokens),
    compactionCount: 0,
    totalTokensRemovedByCompaction: 0,
    turnDurations: [],
    estimatedCost: sum((d) => d.estimatedCost),
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
    turnOpen: false,
    serviceTiers: [],
  }
}

const PROJECTS: Project[] = [
  {
    id: 'proj',
    name: 'proj',
    path: '/proj',
    sessions: [],
    sessionCount: 1,
    localSkills: [],
    localClaudeMd: null,
  },
]

/**
 * The fixture from the accounting audit: one session spanning two days, with a
 * model switch between them. Filtering on the session's last timestamp put all
 * 363 tokens on September 9 and reported September 8 as empty.
 */
const SPLIT_SESSION = session('s1', [
  day({
    day: '2026-09-08',
    inputTokens: 300,
    outputTokens: 30,
    estimatedCost: 3,
    responseCount: 2,
    parentMessageCount: 2,
    childMessageCount: 0,
    messageCount: 2,
    models: [
      {
        model: 'claude-opus-5',
        family: 'opus-5',
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        cacheCreationUnknownTtlTokens: 0,
        estimatedCost: 3,
        turnCount: 2,
      },
    ],
  }),
  day({
    day: '2026-09-09',
    inputTokens: 30,
    outputTokens: 3,
    estimatedCost: 1,
    responseCount: 1,
    messageCount: 1,
    models: [
      {
        model: 'claude-sonnet-5',
        family: 'sonnet-5',
        inputTokens: 30,
        outputTokens: 3,
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

describe('computeAnalytics — a session spanning days', () => {
  it('reports the first day’s tokens on that day', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    expect(a.totalTokens).toBe(330)
  })

  it('reports only the second day’s tokens on that day', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-09', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.totalTokens).toBe(33)
  })

  it('counts the session as active on the earlier day', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    expect(a.totalSessions).toBe(1)
  })

  it('splits the daily series across both days', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.dailyUsage.map((d) => [d.date, d.inputTokens + d.outputTokens])).toEqual([
      ['2026-09-08', 330],
      ['2026-09-09', 33],
    ])
  })

  it('counts one distinct session across a multi-day range, not one per day', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.totalSessions).toBe(1)
  })
})

/**
 * The Overview tab's session table used to filter and total sessions in the
 * renderer via `isWithinRange(session.lastTimestamp, ...)`, ignoring
 * `dailyUsage` entirely. A session spanning two days either vanished on the
 * earlier one (its `lastTimestamp` fell outside the selected day) or, on the
 * later one, was included but showed its *lifetime* totals rather than that
 * day's. `sessionRows` is the fix: built from `daysInRange`, the same rule
 * every other date-scoped series in this file already uses.
 */
describe('computeAnalytics — session rows are scoped to the period', () => {
  it('includes the session on the earlier day, with only that day’s totals', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    expect(a.sessionRows).toHaveLength(1)
    const row = a.sessionRows[0]
    expect(row.sessionId).toBe('s1')
    expect(row.totalInputTokens + row.totalOutputTokens).toBe(330)
    expect(row.estimatedCost).toBe(3)
    expect(row.parentMessageCount).toBe(2)
    expect(row.messageCount).toBe(2)
  })

  it('includes the session on the later day, with only that day’s totals', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-09', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.sessionRows).toHaveLength(1)
    const row = a.sessionRows[0]
    expect(row.sessionId).toBe('s1')
    expect(row.totalInputTokens + row.totalOutputTokens).toBe(33)
    expect(row.estimatedCost).toBe(1)
    expect(row.parentMessageCount).toBe(1)
    expect(row.messageCount).toBe(1)
  })

  it('excludes a session with no activity on the selected day', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-10', to: '2026-09-10' },
      ANTHROPIC_PRICING
    )

    expect(a.sessionRows).toHaveLength(0)
  })

  it('sums both days when the range covers both, rather than reporting either day alone', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.sessionRows).toHaveLength(1)
    const row = a.sessionRows[0]
    expect(row.totalInputTokens + row.totalOutputTokens).toBe(363)
    expect(row.estimatedCost).toBe(4)
    expect(row.messageCount).toBe(3)
  })
})

/**
 * The model chart showed every model the session had ever used, so a day on
 * which only Sonnet ran still listed Opus.
 */
describe('computeAnalytics — model usage is scoped to the period', () => {
  it('lists only the model used on the selected day', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-09', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.modelUsage.map((m) => m.model)).toEqual(['sonnet-5'])
  })

  it('lists both models across a range covering both days', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.modelUsage.map((m) => m.model).sort()).toEqual(['opus-5', 'sonnet-5'])
  })

  it('attributes daily model cost to the day the model ran', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.dailyModelCost.map((d) => [d.date, d.model])).toEqual([
      ['2026-09-08', 'opus-5'],
      ['2026-09-09', 'sonnet-5'],
    ])
  })
})

/**
 * The what-if calculator reprices each token category at the target model's
 * rate, so it needs those pools on `ModelEfficiencyRow` — not just the output
 * pool it already carried. Populated from the wrong source, or never wired
 * up, they ship as zero and the calculator silently projects $0 for every
 * model. Two days of the same model family check that the fields are sums
 * across days, not just a pass-through of one day's row.
 */
describe('computeAnalytics — model efficiency carries per-category token pools', () => {
  it('sums input, cache-read, and cache-creation tokens across days for the what-if calculator', () => {
    const s = session('token-pools', [
      day({
        day: '2026-09-12',
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 200,
            cacheCreation5mTokens: 300,
            cacheCreation1hTokens: 400,
            cacheCreationUnknownTtlTokens: 500,
            estimatedCost: 1,
            turnCount: 1,
          },
        ],
      }),
      day({
        day: '2026-09-13',
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 20,
            cacheCreation5mTokens: 30,
            cacheCreation1hTokens: 40,
            cacheCreationUnknownTtlTokens: 50,
            estimatedCost: 0.5,
            turnCount: 1,
          },
        ],
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-12', to: '2026-09-13' },
      ANTHROPIC_PRICING
    )

    // Plain sums of the per-day model rows above — no pricing involved:
    //   inputTokens          = 100 + 10 = 110
    //   cacheReadTokens      = 200 + 20 = 220
    //   cacheCreation5mTokens= 300 + 30 = 330
    //   cacheCreation1hTokens        = 400 + 40 = 440
    //   cacheCreationUnknownTtlTokens= 500 + 50 = 550
    //   totalOutputTokens            =  50 +  5 =  55
    const row = a.modelEfficiency.find((m) => m.model === 'sonnet-5')
    expect(row?.inputTokens).toBe(110)
    expect(row?.cacheReadTokens).toBe(220)
    expect(row?.cacheCreation5mTokens).toBe(330)
    expect(row?.cacheCreation1hTokens).toBe(440)
    expect(row?.cacheCreationUnknownTtlTokens).toBe(550)
    expect(row?.totalOutputTokens).toBe(55)
  })
})

/**
 * `SessionDayModelUsage.estimatedCost` is null for a model `estimateCost`
 * refused to price. Model efficiency and daily-model-cost used to add that
 * null in with `+=`, which — for an all-unpriced family — is numerically the
 * same as treating it as 0. Skipping it explicitly must produce the identical
 * total for the priced row and a genuine 0 (not a crash, not NaN) for the
 * unpriced one, while the period's unpriced-response count still surfaces.
 */
describe('computeAnalytics — unpriced model rows are skipped, not zeroed, when summing cost', () => {
  it('excludes a null-cost model from totalCost while still counting its tokens and the unpriced response', () => {
    const s = session('unpriced-model', [
      day({
        day: '2026-09-14',
        estimatedCost: 3,
        unpricedResponses: 1,
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 3,
            turnCount: 1,
          },
          {
            model: 'claude-opus-4-9',
            family: 'unknown',
            inputTokens: 1000,
            outputTokens: 1000,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: null,
            turnCount: 1,
          },
        ],
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    expect(a.unpricedResponses).toBe(1)

    const sonnetRow = a.modelEfficiency.find((m) => m.model === 'sonnet-5')
    const unknownRow = a.modelEfficiency.find((m) => m.model === 'unknown')
    expect(sonnetRow?.totalCost).toBe(3)
    expect(sonnetRow?.inputTokens).toBe(100)
    // The unpriced model still contributes its tokens — only its cost is
    // excluded — so it must appear in the breakdown rather than vanish.
    expect(unknownRow?.inputTokens).toBe(1000)
    expect(unknownRow?.totalCost).toBe(0)

    expect(a.dailyModelCost.find((d) => d.model === 'unknown')?.cost).toBe(0)
    expect(a.dailyModelCost.find((d) => d.model === 'sonnet-5')?.cost).toBe(3)
  })
})

/**
 * `CacheAnalytics` used to carry no pricing-coverage information at all, so a
 * model with real cache activity but no pricing entry contributed a
 * confident-looking `0` to every savings figure with nothing to say a
 * response went unpriced. `unpricedResponses` makes that gap visible on the
 * cache tab the same way `AnalyticsData.unpricedResponses` already does on
 * the overview tab.
 */
describe('computeAnalytics — cache tab surfaces unpriced-response coverage', () => {
  it('reports the unpriced response count for a model with cache activity but no pricing entry', () => {
    const s = session('unpriceable-cache-model', [
      day({
        day: '2026-09-14',
        cacheReadTokens: 500_000,
        unpricedResponses: 2,
        models: [
          {
            model: 'claude-future-9',
            family: 'unknown',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 500_000,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: null,
            turnCount: 2,
          },
        ],
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    // The unknown model's cache reads are real activity, but a `0` net
    // savings figure next to them says nothing about why — this count is
    // what tells them apart.
    expect(a.cacheAnalytics.netSavings).toBe(0)
    expect(a.cacheAnalytics.unpricedResponses).toBe(2)
  })

  it('reports zero unpriced responses when every model in range is priced', () => {
    const s = session('fully-priced', [
      day({
        day: '2026-09-14',
        cacheReadTokens: 500_000,
        unpricedResponses: 0,
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 500_000,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 1,
            turnCount: 2,
          },
        ],
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    expect(a.cacheAnalytics.unpricedResponses).toBe(0)
  })
})

/**
 * Task 6: `incompleteUsageResponses`, `responsesWithoutCompletionSignal` and
 * `reducedConfidenceResponses` are detected by the ledger (see `UsageTotals`
 * in `projection.ts`) the same way `unpricedResponses` already is, but before
 * this fix neither `CacheAnalytics` nor `AnalyticsData` carried them — a
 * session with a completeness gap read as clean on both the cache tab and the
 * overview. These pin that both surfaces now carry all three, scoped to the
 * selected range the same way `unpricedResponses` already is.
 */
describe('computeAnalytics — completeness contract carries into cache analytics and the overview', () => {
  it('carries the incomplete-usage count into cache analytics for the selected range', () => {
    const s = session('has-incomplete-usage', [
      day({ day: '2026-09-14', incompleteUsageResponses: 1 }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    expect(a.cacheAnalytics.incompleteUsageResponses).toBe(1)
    expect(a.incompleteUsageResponses).toBe(1)
  })

  it('carries the no-completion-signal and reduced-confidence counts into cache analytics for the selected range', () => {
    const s = session('has-no-completion-signal-and-reduced', [
      day({
        day: '2026-09-14',
        responsesWithoutCompletionSignal: 3,
        reducedConfidenceResponses: 2,
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    expect(a.cacheAnalytics.responsesWithoutCompletionSignal).toBe(3)
    expect(a.cacheAnalytics.reducedConfidenceResponses).toBe(2)
    expect(a.responsesWithoutCompletionSignal).toBe(3)
    expect(a.reducedConfidenceResponses).toBe(2)
  })

  it('keeps the three counts distinct rather than folding them into one another', () => {
    const s = session('keeps-distinct', [
      day({
        day: '2026-09-14',
        unpricedResponses: 1,
        incompleteUsageResponses: 2,
        responsesWithoutCompletionSignal: 3,
        reducedConfidenceResponses: 4,
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    expect(a.unpricedResponses).toBe(1)
    expect(a.incompleteUsageResponses).toBe(2)
    expect(a.responsesWithoutCompletionSignal).toBe(3)
    expect(a.reducedConfidenceResponses).toBe(4)
  })

  it('excludes a day outside the selected range from the completeness counts', () => {
    const s = session('outside-range', [
      day({ day: '2026-09-01', incompleteUsageResponses: 5 }),
      day({ day: '2026-09-14', incompleteUsageResponses: 1 }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-14', to: '2026-09-14' },
      ANTHROPIC_PRICING
    )

    // Only the in-range day's count, not the lifetime sum (6) — matching how
    // every other range-scoped figure in this suite behaves.
    expect(a.incompleteUsageResponses).toBe(1)
    expect(a.cacheAnalytics.incompleteUsageResponses).toBe(1)
  })
})

/**
 * Project costs are a breakdown of the period's total, so they must sum to it.
 * Summing each session's lifetime cost instead made the parts exceed the whole
 * whenever a session straddled the window edge.
 */
describe('computeAnalytics — project costs are a breakdown of the period', () => {
  it('sums project costs to the period total', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-09', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    const summed = a.projectCosts.reduce((s, p) => s + p.totalCost, 0)
    expect(summed).toBeCloseTo(a.totalCost, 10)
    expect(summed).toBeCloseTo(1, 10)
  })

  it('sums project tokens to the period total', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    const summed = a.projectCosts.reduce((s, p) => s + p.totalTokens, 0)
    expect(summed).toBe(a.totalTokens)
    expect(summed).toBe(330)
  })
})

/**
 * A merged project (see project-scanner.ts's `mergeProjectsByResolvedPath` —
 * a git worktree and its main checkout collapsed into one `Project` because
 * they share a resolved cwd) carries sessions from SEVERAL physical
 * directories under one survivor `id`. `buildProjectCosts` used to key its
 * rows by each session's own physical `projectId` instead of the owning
 * (merged) project, which is wrong twice over: a range spanning every
 * session's days undercounts the merged project (only the session that
 * happens to physically live in the survivor directory counts toward it),
 * and a range spanning ONLY the non-survivor sessions' days produces no row
 * under the survivor id at all — the merged project vanishes from the
 * sidebar/Overview despite having real, in-range activity.
 */
describe('computeAnalytics — project costs key by the owning (merged) project, not the physical directory', () => {
  const mainSession: SessionSummary = {
    ...session('s-main', [day({ day: '2026-09-01', inputTokens: 100, estimatedCost: 1 })]),
    projectId: 'main-dir',
  }
  const worktreeASession: SessionSummary = {
    ...session('s-worktree-a', [day({ day: '2026-09-05', inputTokens: 200, estimatedCost: 2 })]),
    projectId: 'alpha-worktree-dir',
  }
  const worktreeBSession: SessionSummary = {
    ...session('s-worktree-b', [day({ day: '2026-09-06', inputTokens: 300, estimatedCost: 3 })]),
    projectId: 'beta-worktree-dir',
  }
  const mergedProject: Project = {
    id: 'main-dir',
    name: 'merged',
    path: '/merged',
    sessions: [mainSession, worktreeASession, worktreeBSession],
    sessionCount: 3,
    localSkills: [],
    localClaudeMd: null,
  }
  const allSessions = [mainSession, worktreeASession, worktreeBSession]

  it('sums every physical directory into the merged project row over a range covering all of them', () => {
    const a = computeAnalytics(
      allSessions,
      [mergedProject],
      { preset: 'custom' as const, from: '2026-09-01', to: '2026-09-06' },
      ANTHROPIC_PRICING
    )

    expect(a.projectCosts).toHaveLength(1)
    expect(a.projectCosts[0].projectId).toBe('main-dir')
    expect(a.projectCosts[0].projectName).toBe('merged')
    expect(a.projectCosts[0].totalTokens).toBe(600)
    expect(a.projectCosts[0].totalCost).toBeCloseTo(6, 10)
    expect(a.projectCosts[0].sessionCount).toBe(3)
  })

  it('does not vanish over a range covering only the worktree sessions’ days', () => {
    const a = computeAnalytics(
      allSessions,
      [mergedProject],
      { preset: 'custom' as const, from: '2026-09-05', to: '2026-09-06' },
      ANTHROPIC_PRICING
    )

    expect(a.projectCosts).toHaveLength(1)
    expect(a.projectCosts[0].projectId).toBe('main-dir')
    expect(a.projectCosts[0].projectName).toBe('merged')
    expect(a.projectCosts[0].totalTokens).toBe(500)
    expect(a.projectCosts[0].totalCost).toBeCloseTo(5, 10)
    expect(a.projectCosts[0].sessionCount).toBe(2)
  })
})

/**
 * Cache savings were priced with Sonnet 4.6 as a stand-in for every model, and
 * per-session savings with whichever model the session used most. Both are
 * wrong for a mixed-model session even when the token counts are right.
 *
 * The report's fixture: 100 cache-read tokens on Sonnet, 900 on Opus. At each
 * model's own rate that is $0.00432; the Sonnet proxy reported $0.00270.
 */
describe('computeAnalytics — cache savings use each model’s own rate', () => {
  const MIXED = session('mixed', [
    day({
      day: '2026-09-08',
      cacheReadTokens: 1000,
      models: [
        {
          model: 'claude-sonnet-4-6',
          family: 'sonnet-4-6',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 100,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          cacheCreationUnknownTtlTokens: 0,
          estimatedCost: 0,
          turnCount: 1,
        },
        {
          model: 'claude-opus-4-6',
          family: 'opus-4-6',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 900,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          cacheCreationUnknownTtlTokens: 0,
          estimatedCost: 0,
          turnCount: 1,
        },
      ],
    }),
  ])

  it('sums savings at each model’s rate rather than a single proxy', () => {
    const a = computeAnalytics(
      [MIXED],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    // sonnet: 100 * (3 - 0.3) + opus: 900 * (5 - 0.5), per million. Neither
    // model wrote any cache in this fixture, so the write premium is 0 and
    // gross read savings equal net savings exactly.
    expect(a.cacheAnalytics.grossReadSavings).toBeCloseTo(0.00432, 10)
    expect(a.cacheAnalytics.netSavings).toBeCloseTo(0.00432, 10)
  })

  it('breaks savings down per model at that model’s rate', () => {
    const a = computeAnalytics(
      [MIXED],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    const byModel = Object.fromEntries(
      a.cacheAnalytics.modelSavings.map((m) => [m.model, m.totalSavings])
    )
    expect(byModel['sonnet-4-6']).toBeCloseTo(0.00027, 10)
    expect(byModel['opus-4-6']).toBeCloseTo(0.00405, 10)

    // Neither model in this fixture wrote to cache, so gross and net coincide.
    const netByModel = Object.fromEntries(
      a.cacheAnalytics.modelSavings.map((m) => [m.model, m.netSavings])
    )
    expect(netByModel['sonnet-4-6']).toBeCloseTo(0.00027, 10)
    expect(netByModel['opus-4-6']).toBeCloseTo(0.00405, 10)
  })

  it('prices a session’s savings from the models it actually used', () => {
    const a = computeAnalytics(
      [MIXED],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    expect(a.cacheAnalytics.sessionEfficiency[0].savingsAmount).toBeCloseTo(0.00432, 10)
  })

  it('does not invent savings for an unpriced model', () => {
    const unknownOnly = session('unknown-only', [
      day({
        day: '2026-09-08',
        cacheReadTokens: 1_000_000,
        models: [
          {
            model: 'claude-future-9',
            family: 'unknown',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 0,
            turnCount: 1,
          },
        ],
      }),
    ])

    const a = computeAnalytics(
      [unknownOnly],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    expect(a.cacheAnalytics.grossReadSavings).toBe(0)
    expect(a.cacheAnalytics.netSavings).toBe(0)
  })
})

/**
 * The service used to report `costSavings = grossReadSavings` and
 * `hypotheticalUncachedCost = actualCost + costSavings`, which credits caching
 * with the full read discount while leaving the cache-write premium — 1.25x
 * input for a 5-minute write, 2x for an hour — buried inside the "without
 * cache" baseline. An uncached request never pays that premium, so it must
 * come out of both the baseline and the net figure. Measured on real history
 * that overstated savings by $526.62 against $24,608.05 of true net savings.
 */
describe('computeAnalytics — net savings subtracts the cache-write premium', () => {
  it('reports net savings after the cache-write premium, not the gross read discount', () => {
    // Sonnet 5: input $2, cache read $0.20, 1h write $4 per MTok.
    // 1M one-hour writes + 1M reads.
    //   with cache   = 1M*$4 + 1M*$0.20 = $4.20
    //   uncached     = 2M*$2            = $4.00
    //   gross read   = 1M*($2 - $0.20)  = $1.80
    //   premium      = 1M*($4 - $2)     = $2.00
    //   net          = -$0.20  (caching cost more over this window)
    const s = session('cache-net', [
      day({
        day: '2026-09-10',
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
    const analytics = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-10', to: '2026-09-10' },
      ANTHROPIC_PRICING
    ).cacheAnalytics

    expect(analytics.grossReadSavings).toBeCloseTo(1.8, 6)
    expect(analytics.writePremium).toBeCloseTo(2.0, 6)
    expect(analytics.netSavings).toBeCloseTo(-0.2, 6)
    expect(analytics.uncachedSameWorkloadCost).toBeCloseTo(4.0, 6)
  })
})

/**
 * "Savings by Model" used to report only the gross read discount
 * (`m.input - m.cacheRead`), with nothing on screen distinguishing it from
 * the headline's net figure. A model with heavy cache writes could show a
 * large positive bar here while actually losing money net of its own write
 * premium.
 */
describe('computeAnalytics — per-model savings account for that model’s own write premium', () => {
  it('reports net separately from gross so a write-heavy model can go negative while a read-only model does not', () => {
    // sonnet-4-6: input $3, cache read $0.30. No cache-creation tokens at all.
    // opus-4-6:   input $5, cache read $0.50, 1h write $10, per MTok.
    // 1M reads on each model; opus also writes 1M one-hour-tier tokens.
    //   sonnet gross = 1M * (3 - 0.3)  = $2.70   sonnet premium = 0            sonnet net = $2.70
    //   opus   gross = 1M * (5 - 0.5)  = $4.50   opus premium = 1M * (10-5) = $5.00   opus net = -$0.50
    const s = session('per-model-net', [
      day({
        day: '2026-09-11',
        cacheReadTokens: 2_000_000,
        cacheCreation1hTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        models: [
          {
            model: 'claude-sonnet-4-6',
            family: 'sonnet-4-6',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 0,
            turnCount: 1,
          },
          {
            model: 'claude-opus-4-6',
            family: 'opus-4-6',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 1_000_000,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 0,
            turnCount: 1,
          },
        ],
      }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-11', to: '2026-09-11' },
      ANTHROPIC_PRICING
    )

    const byModel = Object.fromEntries(a.cacheAnalytics.modelSavings.map((m) => [m.model, m]))

    expect(byModel['sonnet-4-6'].totalSavings).toBeCloseTo(2.7, 6)
    expect(byModel['sonnet-4-6'].netSavings).toBeCloseTo(2.7, 6)

    expect(byModel['opus-4-6'].totalSavings).toBeCloseTo(4.5, 6)
    expect(byModel['opus-4-6'].netSavings).toBeCloseTo(-0.5, 6)
  })
})

/**
 * Task 14 added `cacheCreationUnknownTtlTokens` — the remainder of a cache
 * write whose TTL split was never reported — and prices it at the 5-minute
 * rate in the tier-cost display. Until this fix, `writePremium` and the
 * per-model premium summed only the two known tiers, so an unsplit write
 * contributed nothing to the premium — understating it, and therefore
 * overstating net savings by exactly the remainder's premium.
 */
describe('computeAnalytics — write premium accounts for an unsplit cache write', () => {
  it('prices the unknown-TTL remainder into both the aggregate and per-model premium', () => {
    // sonnet-5: input $2, 5-minute write $2.5 per MTok (the fallback rate an
    // unsplit write is priced at, matching the tier-cost display).
    // 1M unsplit cache-write tokens, no tiers reported, no reads, no other usage.
    //   premium = 1M * (2.5 - 2) = $0.50
    //   gross   = 0 (no cache reads)
    //   net     = 0 - 0.50 = -$0.50
    const s = session('unsplit-write', [
      day({
        day: '2026-09-12',
        cacheCreationTokens: 1_000_000,
        estimatedCost: 2.5,
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 1_000_000,
            estimatedCost: 2.5,
            turnCount: 1,
          },
        ],
      }),
    ])
    const analytics = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-12', to: '2026-09-12' },
      ANTHROPIC_PRICING
    ).cacheAnalytics

    expect(analytics.writePremium).toBeCloseTo(0.5, 6)
    expect(analytics.netSavings).toBeCloseTo(-0.5, 6)

    const sonnet = analytics.modelSavings.find((m) => m.model === 'sonnet-5')!
    expect(sonnet.netSavings).toBeCloseTo(-0.5, 6)
  })
})

/**
 * Task 4: `projection.ts` used to report a cache write's flat counter as the
 * token volume while `ledger.ts` priced its (larger) TTL-tier sum — one
 * response, 40 tokens shown, 100 tokens' worth of dollars charged. This fixes
 * `projection.ts` so a day/model row for such a response already carries the
 * tier sum as its volume (`cacheCreation5mTokens`) with a zero unknown-TTL
 * remainder — this test pins that `computeAnalytics` derives the write
 * premium and the reported token volume from that SAME number, not from the
 * flat counter the premium calculation never even sees.
 */
describe('computeAnalytics — write premium matches the volume the tokens report', () => {
  it('derives the write premium from the same 100-token volume the day and model rows report', () => {
    // sonnet-5: input $2, 5-minute write $2.5 per MTok. A response whose flat
    // counter (40) is smaller than its 5-minute tier (100) — as `ledger.ts`
    // and `projection.ts` now report it: the tier sum (100) is the effective
    // write volume, with a zero unknown-TTL remainder alongside it.
    //   premium = 100 * (2.5 - 2) / 1e6 = $0.00005
    //   a premium based on the flat counter (40) instead would be $0.00002
    const s = session('tiers-exceed-flat', [
      day({
        day: '2026-09-13',
        cacheCreationTokens: 100,
        cacheCreation5mTokens: 100,
        estimatedCost: 0.00025,
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 100,
            cacheCreation1hTokens: 0,
            cacheCreationUnknownTtlTokens: 0,
            estimatedCost: 0.00025,
            turnCount: 1,
          },
        ],
      }),
    ])
    const analytics = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-13', to: '2026-09-13' },
      ANTHROPIC_PRICING
    ).cacheAnalytics

    expect(analytics.totalCacheWriteTokens).toBe(100)
    expect(analytics.writePremium).toBeCloseTo(0.00005, 10)
    expect(analytics.writePremium).not.toBeCloseTo(0.00002, 10)
  })
})

describe('computeAnalytics — cost is scoped to the period', () => {
  it('excludes cost incurred outside the range', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-09', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.totalCost).toBeCloseTo(1, 10)
  })

  it('excludes a session that was not active in the range at all, but still zero-fills the bounded range', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-01', to: '2026-09-02' },
      ANTHROPIC_PRICING
    )

    expect(a.totalSessions).toBe(0)
    expect(a.totalTokens).toBe(0)
    // A bounded range still renders one row per calendar day even when no
    // session was active on any of them — see the zero-fill tests below.
    expect(a.dailyUsage.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02'])
    expect(a.dailyUsage.every((d) => d.inputTokens === 0 && d.sessionCount === 0)).toBe(true)
  })
})

describe('computeAnalytics — average reuse rate with no writes in range', () => {
  it('reports no read/write ratio when the period contains no writes', () => {
    const s = session('reads-only', [
      day({ day: '2026-09-10', cacheReadTokens: 1_000_000, cacheCreationTokens: 0 }),
    ])
    const analytics = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-10', to: '2026-09-10' },
      ANTHROPIC_PRICING
    ).cacheAnalytics
    expect(analytics.averageReuseRate).toBeNull()
  })
})

describe('computeAnalytics — session efficiency ranks by hit ratio before trimming', () => {
  it('keeps the highest hit-ratio session even when its volume is low', () => {
    // Twenty sessions at 50% hit ratio with large read volumes, plus one small
    // session at 99.9%. Sorting by volume first truncates the best one away.
    const bulk = Array.from({ length: 20 }, (_, i) =>
      session(`bulk-${i}`, [
        day({ day: '2026-09-10', inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
      ])
    )
    const best = session('best', [day({ day: '2026-09-10', inputTokens: 1, cacheReadTokens: 999 })])
    const analytics = computeAnalytics(
      [...bulk, best],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-10', to: '2026-09-10' },
      ANTHROPIC_PRICING
    ).cacheAnalytics
    expect(analytics.sessionEfficiency[0].hitRatio).toBeGreaterThan(0.99)
  })
})

describe('computeAnalytics — hit-ratio drops require adjacent calendar days', () => {
  it('does not flag a hit-ratio drop across a multi-day gap', () => {
    // 1 August at 90%, next active day 10 August at 0%.
    const s = session('gap', [
      day({ day: '2026-08-01', inputTokens: 100_000, cacheReadTokens: 900_000 }),
      day({ day: '2026-08-10', inputTokens: 100_000, cacheReadTokens: 0 }),
    ])
    const analytics = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-08-01', to: '2026-08-10' },
      ANTHROPIC_PRICING
    ).cacheAnalytics
    expect(analytics.hitRatioDropDays).toEqual([])
  })
})

describe('computeAnalytics — peak context is a maximum, not a mean', () => {
  it('reports the largest single pre-compaction context, not the mean or the day total', () => {
    // Two compaction events on the SAME day: 10,000 and 90,000 tokens removed.
    // The parser rolls a day up to { compactions: 2, tokensRemovedByCompaction:
    // 100_000, maxPreCompactionTokens: 90_000 } — count and sum across both
    // events, but the max of the two individual events.
    //
    // Mean (buggy code under fix): 100_000 / 2 = 50_000.
    // Day-sum max (the other wrong approach the fix must avoid, since Math.max
    // over per-day sums here has only one day to look at): 100_000.
    // Correct answer — the larger of the two actual events: 90_000.
    const s = session('compacted', [
      day({
        day: '2026-09-10',
        compactions: 2,
        tokensRemovedByCompaction: 100_000,
        maxPreCompactionTokens: 90_000,
      }),
    ])
    const analytics = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-10', to: '2026-09-10' },
      ANTHROPIC_PRICING
    ).cacheAnalytics
    expect(analytics.compactionAnalytics.topSessions[0].peakContextTokens).toBe(90_000)
  })
})

describe('computeAnalytics — session health trend keys off active days, not lastTimestamp', () => {
  it('contributes a two-day session’s health row only to the day queried, not to lastTimestamp’s day', () => {
    // SPLIT_SESSION is active on both 2026-09-08 and 2026-09-09 (lastTimestamp
    // is the 9th). Querying only the 8th must not pile its verdict onto the
    // 9th — the exact defect `toDateKey(session.lastTimestamp)` had.
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-08', to: '2026-09-08' },
      ANTHROPIC_PRICING
    )

    expect(a.sessionHealthSummary.dailyHealthTrend).toEqual([
      { date: '2026-09-08', clean: 1, flagged: 0 },
    ])
  })

  it('gives a legacy session with no dailyUsage a lifetime verdict but no trend day of its own', () => {
    // Same fixture shape as the tray-snapshot legacy-session test: `dailyUsage`
    // is empty but `lastTimestamp` falls inside the queried range, so the
    // outer `filterByDateRange` admits it via its `isWithinRange` fallback.
    // The lifetime verdict (clean/warning/error) is a judgement about the
    // session as a whole and must still count it; the per-day trend reads
    // only `dailyUsage`, so it must count the session on zero days rather
    // than falling back to `lastTimestamp` like the pre-fix code did. The
    // range is still bounded (a 1-day custom range), so it is zero-filled to
    // its one calendar day regardless of whether any session contributed to
    // it — that zero row is the range's, not the legacy session's.
    const legacySession: SessionSummary = {
      ...session('legacy-1', []),
      lastTimestamp: '2026-09-09T12:00:00.000Z',
    }

    const a = computeAnalytics(
      [legacySession],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-09', to: '2026-09-09' },
      ANTHROPIC_PRICING
    )

    expect(a.sessionHealthSummary.cleanCount).toBe(1)
    expect(a.sessionHealthSummary.dailyHealthTrend).toEqual([
      { date: '2026-09-09', clean: 0, flagged: 0 },
    ])
  })
})

/**
 * `computeLatencyAnalytics` only computed a day key at all when
 * `td.assistantTimestamp` was truthy — `toDateKey` never checked whether that
 * truthy value actually parsed, so a corrupted `assistantTimestamp` produced
 * the `NaN-NaN-NaN` key. `toDayKeyOrUndated` gives it `UNDATED_DAY` instead,
 * which — like `NaN-NaN-NaN` before it — sorts outside every real calendar
 * range (it sorts *below* every `YYYY-MM-DD` key rather than above), so the
 * turn was already excluded from a bounded range either way: this test locks
 * in that the malformed entry stays excluded, and that `computeAnalytics`
 * does not throw or otherwise corrupt the histogram/slowest-turns output when
 * fed a real-but-unparsable timestamp.
 */
describe('computeAnalytics — latency ignores a turn duration with an unparsable timestamp', () => {
  it('excludes a malformed-timestamp turn from the histogram and slowest turns without crashing', () => {
    const withDurations: SessionSummary = {
      ...session('latency-1', [day({ day: '2026-09-10', responseCount: 1, messageCount: 1 })]),
      turnDurations: [
        {
          turnIndex: 0,
          durationMs: 2000,
          isPostCompaction: false,
          inputTokens: 0,
          assistantTimestamp: '2026-09-10T10:00:00.000Z',
        },
        {
          turnIndex: 1,
          durationMs: 9000,
          isPostCompaction: false,
          inputTokens: 0,
          assistantTimestamp: 'invalid',
        },
      ],
    }

    const a = computeAnalytics([withDurations], PROJECTS, '30d', ANTHROPIC_PRICING)

    const totalBucketed = a.latencyAnalytics.histogram.reduce((s, b) => s + b.count, 0)
    expect(totalBucketed).toBe(1)
    expect(a.latencyAnalytics.slowestTurns.map((t) => t.turnIndex)).toEqual([0])
  })
})

/**
 * Fix-round-2 finding B: `SlowTurnEntry.projectId` must identify the OWNING
 * (possibly merged) project, the same fix as `buildProjectCosts` — the
 * renderer's `latency-tab.tsx` filters `slowestTurns` by `selectedProjectIds`
 * (always survivor ids), so a turn tagged with its session's raw physical
 * directory would silently drop out of a merged project's latency tab.
 */
describe('computeAnalytics — slow turns key by the owning (merged) project, not the physical directory', () => {
  it('tags a slow turn with the merged survivor id even when its session physically lives in a non-survivor directory', () => {
    const worktreeSession: SessionSummary = {
      ...session('s-worktree', [day({ day: '2026-09-10', responseCount: 1, messageCount: 1 })]),
      projectId: 'worktree-dir',
      turnDurations: [
        {
          turnIndex: 0,
          durationMs: 9000,
          isPostCompaction: false,
          inputTokens: 0,
          assistantTimestamp: '2026-09-10T10:00:00.000Z',
        },
      ],
    }
    const mergedProject: Project = {
      id: 'main-dir',
      name: 'merged',
      path: '/merged',
      sessions: [worktreeSession],
      sessionCount: 1,
      localSkills: [],
      localClaudeMd: null,
    }

    const a = computeAnalytics([worktreeSession], [mergedProject], '30d', ANTHROPIC_PRICING)

    expect(a.latencyAnalytics.slowestTurns).toHaveLength(1)
    expect(a.latencyAnalytics.slowestTurns[0].projectId).toBe('main-dir')
  })
})

/**
 * `resolveDateRange('all')` returns `from = new Date(0)`, whose day key is
 * `1970-01-01`. `UNDATED_DAY` (`'('`, 0x28) sorts lexically below `'1'`
 * (0x31), so it falls below even the all-time lower bound in the plain
 * string comparison `daysInRange` uses — before this fix, one undated user
 * record gave `summary.messageCount === 1` but
 * `computeAnalytics(..., 'all').totalMessages === 0`, and a session whose
 * only activity was undated was absent from all-time analytics entirely.
 * `daysInRange` now admits `UNDATED_DAY` for the `all` preset specifically
 * (passed down as an explicit `includeUndated` flag, never by changing the
 * lexical comparison itself — see its doc comment), while every other preset
 * keeps excluding it because undated activity cannot be attributed to a
 * calendar window. `AnalyticsData.undatedActivity` reports the count either
 * way.
 */
describe('computeAnalytics — the undated bucket in all-time totals', () => {
  // One user record with no parsable timestamp and no assistant response —
  // the exact fixture the accounting audit found: `summary.messageCount`
  // is 1, but before this fix `computeAnalytics(..., 'all').totalMessages`
  // was 0 and this session did not appear in all-time analytics at all.
  const UNDATED_ONLY_SESSION = session('undated-1', [
    day({
      day: UNDATED_DAY,
      responseCount: 0,
      parentMessageCount: 1,
      childMessageCount: 0,
      messageCount: 1,
    }),
  ])

  it('includes undated activity in all-time totals', () => {
    const a = computeAnalytics([UNDATED_ONLY_SESSION], PROJECTS, 'all', ANTHROPIC_PRICING)
    expect(a.totalMessages).toBe(1)
    expect(a.undatedActivity).toEqual({ messages: 1, responses: 0, includedInTotals: true })
  })

  it('excludes undated activity from a calendar range but still reports it', () => {
    const a = computeAnalytics([UNDATED_ONLY_SESSION], PROJECTS, '30d', ANTHROPIC_PRICING)
    expect(a.totalMessages).toBe(0)
    expect(a.undatedActivity.messages).toBe(1)
    expect(a.undatedActivity.includedInTotals).toBe(false)
  })

  it('a session whose only activity is undated is present in all-time analytics', () => {
    const a = computeAnalytics([UNDATED_ONLY_SESSION], PROJECTS, 'all', ANTHROPIC_PRICING)
    expect(a.totalMessages).toBeGreaterThan(0)
    expect(a.totalSessions).toBe(1)
  })

  it('folds undated effort, parallel-tool and compaction activity into all-time totals too', () => {
    // Task 2 routed effort/parallel/compaction per-day attribution through
    // the same `UNDATED_DAY` bucket as messages. This is the "consequence
    // you must expect" the brief calls out: since every one of these reads
    // through the same `daysInRange`, admitting the bucket for `all` grows
    // all three at once, not just `totalMessages` — and this is the intended
    // outcome of a single shared policy, not a new bug.
    const richUndatedSession = session('undated-2', [
      day({
        day: UNDATED_DAY,
        responseCount: 1,
        parentMessageCount: 1,
        childMessageCount: 0,
        messageCount: 1,
        effortDistribution: { low: 0, medium: 0, high: 1, ultrathink: 0 },
        parallelToolGroups: 2,
        maxParallelDegree: 3,
        compactions: 1,
        tokensRemovedByCompaction: 5000,
        maxPreCompactionTokens: 5000,
      }),
    ])

    const allTime = computeAnalytics([richUndatedSession], PROJECTS, 'all', ANTHROPIC_PRICING)
    const thirtyDays = computeAnalytics([richUndatedSession], PROJECTS, '30d', ANTHROPIC_PRICING)

    expect(allTime.effortAnalytics.distribution.high).toBe(1)
    expect(allTime.parallelToolAnalytics.totalParallelGroups).toBe(2)
    expect(allTime.cacheAnalytics.compactionAnalytics.totalCompactions).toBe(1)

    expect(thirtyDays.effortAnalytics.distribution.high).toBe(0)
    expect(thirtyDays.parallelToolAnalytics.totalParallelGroups).toBe(0)
    expect(thirtyDays.cacheAnalytics.compactionAnalytics.totalCompactions).toBe(0)
  })
})

/**
 * The reported defect: a "7d" chart showed only 6 days. `resolveDateRange`
 * was never wrong — it already resolves '7d' to exactly 7 keys — but
 * `buildDailyUsage` only ever emitted a row for a day that HAD activity, so
 * an idle day (most visibly today, early in it) was silently absent rather
 * than present with zeros. These tests pin the fix: every bounded preset
 * renders one row per calendar day, `all` is deliberately excluded (its
 * lower bound is 1970), `UNDATED_DAY` never becomes a zero row, and no
 * figure changes — zeros add nothing to any sum.
 */
describe('computeAnalytics — bounded ranges zero-fill idle days', () => {
  /** `n` calendar days before the real "now" the test happens to run at. */
  function daysAgo(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return toDateKey(d)
  }

  it('a bounded range renders one entry per calendar day even when idle', () => {
    // Active on only 2 of the last 7 days: 6 days ago, and today.
    const s = session('active-2-of-7', [
      day({ day: daysAgo(6), inputTokens: 10 }),
      day({ day: daysAgo(0), inputTokens: 20 }),
    ])

    const a = computeAnalytics([s], PROJECTS, '7d', ANTHROPIC_PRICING)

    expect(a.dailyUsage).toHaveLength(7)
    expect(a.dailyUsage.filter((d) => d.inputTokens === 0)).toHaveLength(5)
  })

  it.each(['today', '7d', '30d'] as const)('%s yields exactly its key count', (preset) => {
    const s = session('active-today-only', [day({ day: daysAgo(0), inputTokens: 5 })])
    const { from, to } = resolveDateRange(preset)

    const a = computeAnalytics([s], PROJECTS, preset, ANTHROPIC_PRICING)

    expect(a.dailyUsage).toHaveLength(dateKeysInRange(from, to).length)
  })

  it('all-time is not zero-filled back to 1970', () => {
    const s = session('active-today-only', [day({ day: daysAgo(0), inputTokens: 5 })])

    const a = computeAnalytics([s], PROJECTS, 'all', ANTHROPIC_PRICING)

    expect(a.dailyUsage.length).toBeLessThan(1000)
  })

  // No `it.each` guarding "no dailyUsage entry is the undated sentinel under
  // a bounded preset" here on purpose: `daysInRange` already excludes
  // `UNDATED_DAY` from every bounded preset via `includeUndated` (see its own
  // doc comment) BEFORE the zero-fill ever runs, and `computeAnalytics` never
  // sets `includeUndated` except for `all` — a bounded preset's
  // `observedDailyUsage` structurally cannot contain `UNDATED_DAY` in the
  // first place, with or without this task's fill. A version of that
  // assertion was here and looked like coverage, but no mutation of the fill
  // itself could ever fail it: `zeroFillDailySeries` now preserves any
  // out-of-fill-range entry it's given (see "keeps a real day beyond the
  // fill clamp" above), so even routing `UNDATED_DAY` through it would no
  // longer strip it out — the guarantee lives entirely in `daysInRange`,
  // which already has its own coverage (`excludes undated activity from a
  // calendar range but still reports it`, above). Removed rather than kept
  // as a check that cannot fail.

  it('all does not zero-fill: a genuine undated day keeps its real values, whatever the corpus size', () => {
    // Unlike a bounded preset, `all` legitimately admits `UNDATED_DAY` into
    // `dailyUsage` (`includeUndated` is true only for `all`) — this pins
    // that the actual field values survive intact. It does NOT prove
    // `shouldZeroFill` is false for `all`: `zeroFillDailySeries` now
    // preserves an out-of-range entry either way (see its own doc comment),
    // so if `all` were ever misrouted through the fill, this specific
    // assertion would still pass — what would catch that misrouting is
    // `dailyUsage.length` exploding to tens of thousands, already pinned by
    // "all-time is not zero-filled back to 1970" above.
    const s = session('has-real-undated-activity', [
      day({ day: UNDATED_DAY, inputTokens: 42, messageCount: 3 }),
    ])

    const a = computeAnalytics([s], PROJECTS, 'all', ANTHROPIC_PRICING)

    const undatedRow = a.dailyUsage.find((d) => d.date === UNDATED_DAY)
    expect(undatedRow?.inputTokens).toBe(42)
    expect(undatedRow?.messageCount).toBe(3)
  })

  it('zero-filling a bounded range leaves every summed figure unchanged', () => {
    const s = session('active-2-of-7', [
      day({ day: daysAgo(6), inputTokens: 100, outputTokens: 10, estimatedCost: 1 }),
      day({ day: daysAgo(0), inputTokens: 50, outputTokens: 5, estimatedCost: 0.5 }),
    ])

    const a = computeAnalytics([s], PROJECTS, '7d', ANTHROPIC_PRICING)

    expect(a.dailyUsage.reduce((sum, d) => sum + d.inputTokens, 0)).toBe(150)
    expect(a.dailyUsage.reduce((sum, d) => sum + d.outputTokens, 0)).toBe(15)
    expect(a.dailyUsage.reduce((sum, d) => sum + d.estimatedCost, 0)).toBeCloseTo(1.5, 10)
    expect(a.dailyUsage.reduce((sum, d) => sum + d.sessionCount, 0)).toBe(2)
  })

  it('zero-fills effortOverTime the same way, for the same bounded range', () => {
    const s = session('effort-2-of-7', [
      day({
        day: daysAgo(6),
        effortDistribution: { low: 1, medium: 0, high: 0, ultrathink: 0 },
      }),
      day({
        day: daysAgo(0),
        effortDistribution: { low: 0, medium: 1, high: 0, ultrathink: 0 },
      }),
    ])

    const a = computeAnalytics([s], PROJECTS, '7d', ANTHROPIC_PRICING)

    expect(a.effortAnalytics.effortOverTime).toHaveLength(7)
    const idleDays = a.effortAnalytics.effortOverTime.filter(
      (e) =>
        e.distribution.low +
          e.distribution.medium +
          e.distribution.high +
          e.distribution.ultrathink ===
        0
    )
    expect(idleDays).toHaveLength(5)
  })

  it('does not zero-fill dailyModelCost: it stays one row per (day, model) actually observed', () => {
    const s = session('active-today-only', [
      day({
        day: daysAgo(0),
        models: [
          {
            model: 'claude-sonnet-5',
            family: 'sonnet-5',
            inputTokens: 10,
            outputTokens: 5,
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

    const a = computeAnalytics([s], PROJECTS, '7d', ANTHROPIC_PRICING)

    // 7 calendar days in range, only 1 has model activity — no zero-filled
    // placeholder rows for the other 6, unlike `dailyUsage` above.
    expect(a.dailyModelCost).toHaveLength(1)
  })

  it('zero-fills sessionHealthSummary.dailyHealthTrend the same way, without moving the lifetime verdict counts', () => {
    // `HealthTrendChart` draws this as `<Line type="monotone">`, which
    // interpolates BETWEEN points — a missing idle day used to draw a smooth,
    // plausible-looking slope straight across days nothing happened on,
    // which is worse than a gap: it looks like data.
    const clean = session('clean-1-of-7', [day({ day: daysAgo(6) })])
    const flagged = session('flagged-today', [day({ day: daysAgo(0), estimatedCost: 999 })])

    const a = computeAnalytics([clean, flagged], PROJECTS, '7d', ANTHROPIC_PRICING)

    expect(a.sessionHealthSummary.dailyHealthTrend).toHaveLength(7)
    const idleDays = a.sessionHealthSummary.dailyHealthTrend.filter(
      (d) => d.clean === 0 && d.flagged === 0
    )
    expect(idleDays).toHaveLength(5)
    // The lifetime verdict is a judgement about each session as a whole and
    // must not move just because idle days were added to the daily trend.
    expect(a.sessionHealthSummary.cleanCount).toBe(1)
    expect(a.sessionHealthSummary.warningCount).toBe(1)
    expect(a.sessionHealthSummary.errorCount).toBe(0)
  })

  it('clamps the zero-fill upper bound to today: a custom range ending in the future never fabricates future days', () => {
    const s = session('active-today-only', [day({ day: daysAgo(0), inputTokens: 5 })])
    const future = new Date()
    future.setDate(future.getDate() + 30)

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: daysAgo(3), to: toDateKey(future) },
      ANTHROPIC_PRICING
    )

    const todayKey = daysAgo(0)
    expect(a.dailyUsage.every((d) => d.date <= todayKey)).toBe(true)
    // Today minus 3 through today, inclusive: 4 real days — not 34.
    expect(a.dailyUsage).toHaveLength(4)
  })

  it('keeps a real day beyond the fill clamp: the series sum still matches the headline total for a range extending into the future', () => {
    // The clamp exists to stop FABRICATING future zero rows, not to drop
    // OBSERVED ones — a future-dated response (clock skew, a timezone edge)
    // is real data, and it was visible before this fix landed. today+2 is
    // past `zeroFillTo` (today) but still inside the selected range
    // (today-3 .. today+5), so it must survive into `dailyUsage` even though
    // the fill itself never reaches out that far to manufacture a row there.
    const s = session('spans-into-the-future', [
      day({ day: daysAgo(1), inputTokens: 100, estimatedCost: 1 }),
      day({ day: daysAgo(-2), inputTokens: 777, estimatedCost: 7 }),
    ])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      { preset: 'custom' as const, from: daysAgo(3), to: daysAgo(-5) },
      ANTHROPIC_PRICING
    )

    expect(a.totalTokens).toBe(877)
    expect(a.totalCost).toBeCloseTo(8, 10)
    const seriesTokens = a.dailyUsage.reduce((sum, d) => sum + d.inputTokens, 0)
    const seriesCost = a.dailyUsage.reduce((sum, d) => sum + d.estimatedCost, 0)
    // The series must reconcile with the headline above it, not undercount it.
    expect(seriesTokens).toBe(a.totalTokens)
    expect(seriesCost).toBeCloseTo(a.totalCost, 10)
    // The real future day is present...
    expect(a.dailyUsage.some((d) => d.date === daysAgo(-2))).toBe(true)
    // ...but nothing further out than it was fabricated as a zero row.
    expect(a.dailyUsage.some((d) => d.date === daysAgo(-5))).toBe(false)
    expect(a.dailyUsage.some((d) => d.date === daysAgo(-3))).toBe(false)
  })

  it('does not zero-fill a pathologically wide custom range (span cap)', () => {
    const s = session('active-today-only', [day({ day: daysAgo(0), inputTokens: 5 })])

    const a = computeAnalytics(
      [s],
      PROJECTS,
      // 401 calendar days — over MAX_ZERO_FILL_DAYS (366) — so this falls
      // back to `all`'s sparse, observed-days-only behaviour rather than
      // synthesising 400 empty rows.
      { preset: 'custom' as const, from: daysAgo(400), to: daysAgo(0) },
      ANTHROPIC_PRICING
    )

    expect(a.dailyUsage).toHaveLength(1)
  })

  it.each(['today', '7d', '30d'] as const)(
    // `DailyUsageChart`/`EffortOverTimeChart`'s "No data for this period"
    // branch (`data.length === 0`) is only reachable when `dailyUsage` can
    // legitimately be empty. This pins that it no longer can be, for any
    // bounded preset, even with zero sessions at all — the branch is dead
    // for these three, and only `all` (below) still reaches it.
    '%s zero-fills even a completely empty corpus, so dailyUsage is never empty',
    (preset) => {
      const a = computeAnalytics([], PROJECTS, preset, ANTHROPIC_PRICING)
      expect(a.dailyUsage.length).toBeGreaterThan(0)
    }
  )

  it('all stays empty for a completely empty corpus — the one case the "No data" branch still guards', () => {
    const a = computeAnalytics([], PROJECTS, 'all', ANTHROPIC_PRICING)
    expect(a.dailyUsage).toEqual([])
  })

  it.each(['7d', '30d'] as const)(
    // `HealthTrendChart`'s "Not enough data for a trend" branch
    // (`trend.length < 2`) is now reachable only for `today` (always exactly
    // 1 point) and for `all`/the span-cap fallback (below) — this pins that
    // it is unreachable for any other bounded preset, even with zero
    // sessions at all.
    '%s zero-fills dailyHealthTrend to at least 2 points, even with zero sessions',
    (preset) => {
      const a = computeAnalytics([], PROJECTS, preset, ANTHROPIC_PRICING)
      expect(a.sessionHealthSummary.dailyHealthTrend.length).toBeGreaterThanOrEqual(2)
    }
  )

  it('today zero-fills dailyHealthTrend to exactly 1 point, even with zero sessions', () => {
    // 1 point is correctly "not enough for a trend" — `today` is the one
    // bounded preset where the chart's branch stays legitimately reachable.
    const a = computeAnalytics([], PROJECTS, 'today', ANTHROPIC_PRICING)
    expect(a.sessionHealthSummary.dailyHealthTrend).toHaveLength(1)
  })
})
