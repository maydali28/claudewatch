import { describe, expect, it } from 'vitest'
import type { SessionSummary, SessionDayUsage } from '@shared/types/session'
import type { Project } from '@shared/types/project'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
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
    responseCount: 1,
    messageCount: 1,
    parentEstimatedCost: 0,
    compactions: 0,
    tokensRemovedByCompaction: 0,
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

    // sonnet: 100 * (3 - 0.3) + opus: 900 * (5 - 0.5), per million
    expect(a.cacheAnalytics.costSavings).toBeCloseTo(0.00432, 10)
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

    expect(a.cacheAnalytics.costSavings).toBe(0)
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

  it('excludes a session that was not active in the range at all', () => {
    const a = computeAnalytics(
      [SPLIT_SESSION],
      PROJECTS,
      { preset: 'custom' as const, from: '2026-09-01', to: '2026-09-02' },
      ANTHROPIC_PRICING
    )

    expect(a.totalSessions).toBe(0)
    expect(a.totalTokens).toBe(0)
    expect(a.dailyUsage).toEqual([])
  })
})
