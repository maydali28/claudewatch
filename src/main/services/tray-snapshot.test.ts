import { describe, expect, it, vi } from 'vitest'
import type { SessionSummary, SessionDayUsage } from '@shared/types/session'
import type { Project } from '@shared/types/project'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { toDateKey } from '@shared/utils/date-ranges'
import * as analyticsEngine from './analytics-engine'
import { buildTraySnapshot } from './tray-snapshot'

// ─── Fixture builders — trimmed copies of the ones in analytics-engine.test.ts,
// kept local so this file does not depend on another test file's internals. ───

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

function session(id: string, projectId: string, dailyUsage: SessionDayUsage[]): SessionSummary {
  const sum = (pick: (d: SessionDayUsage) => number): number =>
    dailyUsage.reduce((s, d) => s + pick(d), 0)
  return {
    id,
    projectId,
    projectPath: `/${projectId}`,
    title: id,
    firstTimestamp: `${dailyUsage[0]?.day ?? '2026-09-08'}T09:00:00.000Z`,
    lastTimestamp: `${dailyUsage[dailyUsage.length - 1]?.day ?? '2026-09-08'}T23:00:00.000Z`,
    messageCount: sum((d) => d.messageCount),
    parentMessageCount: sum((d) => d.messageCount),
    modelsUsed: [],
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

function project(id: string, sessions: SessionSummary[]): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
    pathResolved: true,
    sessions,
    sessionCount: sessions.length,
    localSkills: [],
    localClaudeMd: null,
  }
}

// ─── A fixture with activity on several days, including today, spread across
// two projects — one of which is NOT active today, so a naive "count distinct
// projects over the whole week" figure would overcount today's projects. ───

function keyDaysAgo(n: number): string {
  return toDateKey(new Date(Date.now() - n * 86_400_000))
}

const TODAY_KEY = keyDaysAgo(0)
const YESTERDAY_KEY = keyDaysAgo(1)
const THREE_DAYS_AGO_KEY = keyDaysAgo(3)

// Project "alpha": active today and yesterday.
const ALPHA_SESSION = session('alpha-1', 'alpha', [
  day({
    day: YESTERDAY_KEY,
    inputTokens: 100,
    outputTokens: 20,
    estimatedCost: 2,
    messageCount: 3,
  }),
  day({ day: TODAY_KEY, inputTokens: 50, outputTokens: 10, estimatedCost: 1, messageCount: 2 }),
])

// Project "beta": active only three days ago — inside the 7-day window, but
// not today. Its presence is what makes `week.projectCosts.length` (2) diverge
// from today's distinct project count (1).
const BETA_SESSION = session('beta-1', 'beta', [
  day({
    day: THREE_DAYS_AGO_KEY,
    inputTokens: 500,
    outputTokens: 40,
    estimatedCost: 5,
    messageCount: 4,
  }),
])

const PROJECTS: Project[] = [project('alpha', [ALPHA_SESSION]), project('beta', [BETA_SESSION])]

describe('buildTraySnapshot', () => {
  it('computes analytics once for the tray', () => {
    const spy = vi.spyOn(analyticsEngine, 'computeAnalytics')

    buildTraySnapshot(PROJECTS, ANTHROPIC_PRICING)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      [ALPHA_SESSION, BETA_SESSION],
      PROJECTS,
      '7d',
      ANTHROPIC_PRICING
    )
    spy.mockRestore()
  })

  it('matches the figures the old two-pass computation produced', () => {
    const sessions = [ALPHA_SESSION, BETA_SESSION]

    // Ground truth, computed the way the tray used to: one full pass per
    // range. This pins the values the single-pass rewrite must reproduce.
    const expectedToday = analyticsEngine.computeAnalytics(
      sessions,
      PROJECTS,
      'today',
      ANTHROPIC_PRICING
    )
    const expectedWeek = analyticsEngine.computeAnalytics(
      sessions,
      PROJECTS,
      '7d',
      ANTHROPIC_PRICING
    )

    const snapshot = buildTraySnapshot(PROJECTS, ANTHROPIC_PRICING)

    expect(snapshot.today).toEqual({
      sessionCount: expectedToday.totalSessions,
      tokenCount: expectedToday.totalTokens,
      messageCount: expectedToday.totalMessages,
      cost: expectedToday.totalCost,
      projectCount: expectedToday.projectCosts.length,
    })
    // Sanity check that the fixture actually exercises the divergence: the
    // week sees both projects, today sees only one.
    expect(expectedWeek.projectCosts.length).toBe(2)
    expect(expectedToday.projectCosts.length).toBe(1)

    expect(snapshot.weekly).toEqual(
      expectedWeek.dailyUsage.map((d) => ({
        date: d.date,
        tokens: d.inputTokens + d.outputTokens,
        cost: d.estimatedCost,
      }))
    )
  })

  it('excludes a legacy session with no dailyUsage from both sessionCount and projectCount', () => {
    // A cache entry written before per-day accounting existed: `dailyUsage`
    // is empty but `lastTimestamp` still falls on today. `filterByDateRange`
    // would admit it via its `isWithinRange` fallback, but `buildDailyUsage`
    // and `buildProjectCosts` only ever read `dailyUsage`, so neither counts
    // it — see the comment on `todaysProjectCount` for the two membership
    // rules this pins against disagreeing again.
    const normalSession = session('normal-1', 'proj-a', [
      day({ day: TODAY_KEY, inputTokens: 10, outputTokens: 2, estimatedCost: 1, messageCount: 1 }),
    ])
    const legacySession: SessionSummary = {
      ...session('legacy-1', 'proj-b', []),
      lastTimestamp: `${TODAY_KEY}T12:00:00.000Z`,
    }
    const projects = [project('proj-a', [normalSession]), project('proj-b', [legacySession])]

    const snapshot = buildTraySnapshot(projects, ANTHROPIC_PRICING)

    expect(snapshot.today.sessionCount).toBe(1)
    expect(snapshot.today.projectCount).toBe(1)
  })

  /**
   * Fix-round-2 finding A: a project merged from several worktree directories
   * (`project-scanner.ts`'s `mergeProjectsByResolvedPath`) has sessions whose
   * own `projectId` is each session's PHYSICAL directory, never the merged
   * survivor id. Counting those directly, as before, reported one merged
   * project as three ("today.projectCount: 3") even though its token/cost
   * totals — summed, not counted — were already correct.
   */
  it('counts a project merged from three worktree directories as one, not one per physical directory', () => {
    const mainSession = session('s-main', 'main-dir', [
      day({ day: TODAY_KEY, inputTokens: 1000, outputTokens: 100, estimatedCost: 1 }),
    ])
    const worktreeASession = session('s-worktree-a', 'alpha-worktree-dir', [
      day({ day: TODAY_KEY, inputTokens: 1000, outputTokens: 100, estimatedCost: 1 }),
    ])
    const worktreeBSession = session('s-worktree-b', 'beta-worktree-dir', [
      day({ day: TODAY_KEY, inputTokens: 1000, outputTokens: 100, estimatedCost: 1 }),
    ])
    const mergedProject: Project = {
      id: 'main-dir',
      name: 'merged',
      path: '/merged',
      pathResolved: true,
      sessions: [mainSession, worktreeASession, worktreeBSession],
      sessionCount: 3,
      localSkills: [],
      localClaudeMd: null,
    }

    const snapshot = buildTraySnapshot([mergedProject], ANTHROPIC_PRICING)

    expect(snapshot.today.projectCount).toBe(1)
    // Tokens were already correct before this fix — summing, unlike
    // counting distinct ids, is naturally immune to which id a session
    // carries.
    expect(snapshot.today.tokenCount).toBe(3300)
  })

  it('reports zeroes, not undefined or NaN, on a quiet day with no activity today', () => {
    const quietSession = session('quiet-1', 'quiet', [
      day({ day: THREE_DAYS_AGO_KEY, inputTokens: 10, outputTokens: 5, estimatedCost: 1 }),
    ])
    const quietProjects = [project('quiet', [quietSession])]

    const snapshot = buildTraySnapshot(quietProjects, ANTHROPIC_PRICING)

    expect(snapshot.today).toEqual({
      sessionCount: 0,
      tokenCount: 0,
      messageCount: 0,
      cost: 0,
      projectCount: 0,
    })
    for (const value of Object.values(snapshot.today)) {
      expect(Number.isNaN(value)).toBe(false)
      expect(value).not.toBeUndefined()
    }
  })
})

/**
 * `sessions` here is every session across every project with no upstream
 * filter for a parseable `lastTimestamp`, unlike e.g. `sec.rules.ts`'s
 * eligibility filter — so this sort is directly exposed to the same
 * `NaN`-comparator bug already fixed at four other timestamp-sort call
 * sites on this branch.
 */
describe('buildTraySnapshot — recentSessions ordering is NaN-safe', () => {
  it('sorts recent sessions by lastTimestamp without an unparsable one corrupting the order', () => {
    // Comfortably outside ACTIVE_SESSION_MS (60s) for every session below,
    // so all three land in `recentSessions` rather than `activeSessions`.
    const FIXED_NOW = new Date('2026-01-10T00:00:00.000Z').getTime()

    const newest: SessionSummary = {
      ...session('newest', 'p', [day({ day: '2026-01-05' })]),
      lastTimestamp: '2026-01-05T12:00:00.000Z',
    }
    const oldest: SessionSummary = {
      ...session('oldest', 'p', [day({ day: '2026-01-01' })]),
      lastTimestamp: '2026-01-01T12:00:00.000Z',
    }
    const garbage: SessionSummary = {
      ...session('garbage', 'p', [day({ day: '2026-01-03' })]),
      lastTimestamp: 'not-a-timestamp',
    }

    // Deliberately not already in the correct final order.
    const projects = [project('p', [garbage, newest, oldest])]

    const snapshot = buildTraySnapshot(projects, ANTHROPIC_PRICING, FIXED_NOW)

    // Descending by time; the unparsable one is never evidence of recency
    // and must sort last, deterministically.
    expect(snapshot.recentSessions.map((s) => s.id)).toEqual(['newest', 'oldest', 'garbage'])
  })
})

describe('buildTraySnapshot — liveness considers an open turn, not only the last write', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()

  it('keeps a session whose turn is still open in activeSessions through a long silent tool run', () => {
    const open: SessionSummary = {
      ...session('open-1', 'alpha', [day({ day: TODAY_KEY, messageCount: 1 })]),
      lastTimestamp: fiveMinutesAgo,
      turnOpen: true,
    }
    const snapshot = buildTraySnapshot([project('alpha', [open])], ANTHROPIC_PRICING)
    expect(snapshot.activeSessions.map((s) => s.id)).toEqual(['open-1'])
    expect(snapshot.activeSessions[0].turnOpen).toBe(true)
    expect(snapshot.recentSessions).toEqual([])
  })

  it('moves a session whose turn has closed to recentSessions once the short window passes', () => {
    const closed: SessionSummary = {
      ...session('closed-1', 'alpha', [day({ day: TODAY_KEY, messageCount: 1 })]),
      lastTimestamp: fiveMinutesAgo,
      turnOpen: false,
    }
    const snapshot = buildTraySnapshot([project('alpha', [closed])], ANTHROPIC_PRICING)
    expect(snapshot.activeSessions).toEqual([])
    expect(snapshot.recentSessions.map((s) => s.id)).toEqual(['closed-1'])
  })
})
