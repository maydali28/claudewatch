import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types/project'
import type { SessionSummary } from '@shared/types/session'

// project-scanner.ts pulls in the full session-parser → metadata-parser
// chain, which imports '@main/lib/logger'; that module calls electron-log's
// initialize() at import time, which throws outside a real Electron main
// context (see autostart.test.ts for the same workaround). Only
// `sortProjectsByLatestSession` — a pure array sort — is under test here.
// vi.mock is hoisted above these imports, so the static import below resolves
// against the mock rather than the real logger module.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  rootLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { sortProjectsByLatestSession, sortSessionsByLatestTimestamp } from './project-scanner'

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    projectId: 'proj',
    projectPath: '/proj',
    title: 'session',
    firstTimestamp: '2026-01-01T00:00:00.000Z',
    lastTimestamp: '2026-01-01T00:00:00.000Z',
    messageCount: 1,
    parentMessageCount: 1,
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
      effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 0 },
      errorClassifications: [],
      hasIdleZombieGap: false,
      estimatedIdleWasteCost: 0,
      compactionTimestamps: [],
      parallelToolCallCount: 0,
      maxParallelDegree: 0,
      isWorktreeSession: false,
    },
    subagents: [],
    dailyUsage: [],
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
    ...overrides,
  }
}

function makeProject(id: string, lastTimestamp: string): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
    // getValidSortedSessionForProject already sorts each project's own
    // sessions most-recent-first, so index 0 is always the project's latest.
    sessions: [makeSummary({ lastTimestamp })],
    sessionCount: 1,
    localSkills: [],
    localClaudeMd: null,
  }
}

/**
 * `lastTimestamp` is raw transcript text with no guaranteed `Z` suffix.
 * `sortProjectsByLatestSession` used to order the sidebar's project list with
 * `.localeCompare`, which sorted by digits instead of by the instant those
 * digits name — the same defect fixed in the accounting projection's "latest
 * model" badge and the Overview table's "Last active" sort.
 */
describe('sortProjectsByLatestSession', () => {
  it('orders correctly when timestamps carry mixed offsets', () => {
    // '+02:00' names the instant 2026-09-13T22:30:00Z — earlier than 'b'
    // below — but as raw text it sorts AFTER 'b' because '14' > '13' in the
    // date portion, which is exactly what a lexical comparison gets backwards.
    const a = makeProject('a', '2026-09-14T00:30:00+02:00')
    const b = makeProject('b', '2026-09-13T23:00:00Z')

    expect(sortProjectsByLatestSession([a, b]).map((p) => p.id)).toEqual(['b', 'a'])
    expect(sortProjectsByLatestSession([b, a]).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('all-Z corpus orders correctly (regression pin)', () => {
    const a = makeProject('a', '2026-09-09T00:00:00.000Z')
    const b = makeProject('b', '2026-09-08T00:00:00.000Z')

    expect(sortProjectsByLatestSession([b, a]).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('sorts a project with an unparseable timestamp as least recent, never first by accident', () => {
    // Rule: an unparseable timestamp is never evidence that a project is
    // more recently active than one with a real timestamp, so it always
    // sorts last in this most-recent-first list.
    const a = makeProject('a', '2026-09-09T00:00:00.000Z')
    const garbage = makeProject('garbage', 'not-a-timestamp')
    const b = makeProject('b', '2026-09-08T00:00:00.000Z')

    expect(sortProjectsByLatestSession([garbage, a, b]).map((p) => p.id)).toEqual([
      'a',
      'b',
      'garbage',
    ])
  })

  it('treats a project with no sessions the same as an unparseable timestamp', () => {
    const a = makeProject('a', '2026-09-09T00:00:00.000Z')
    const empty: Project = { ...makeProject('empty', ''), sessions: [] }

    expect(sortProjectsByLatestSession([empty, a]).map((p) => p.id)).toEqual(['a', 'empty'])
  })

  it('does not mutate the input array', () => {
    const a = makeProject('a', '2026-09-08T00:00:00.000Z')
    const b = makeProject('b', '2026-09-09T00:00:00.000Z')
    const input = [a, b]

    sortProjectsByLatestSession(input)

    expect(input.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

/**
 * `getValidSortedSessionForProject` (the full-scan path, not under test here
 * since it touches disk) orders each project's OWN sessions most-recent-first
 * via this pure helper before `scanProjects` returns. Its `!== ''` filter on
 * the caller's side only rejects an absent `lastTimestamp`, not a malformed
 * non-empty one, so this is the session-level twin of
 * `sortProjectsByLatestSession` above — same defect class, same file, missed
 * by that earlier fix.
 */
describe('sortSessionsByLatestTimestamp', () => {
  it('orders correctly when timestamps carry mixed offsets', () => {
    const a = makeSummary({ id: 'a', lastTimestamp: '2026-09-14T00:30:00+02:00' })
    const b = makeSummary({ id: 'b', lastTimestamp: '2026-09-13T23:00:00Z' })

    expect(sortSessionsByLatestTimestamp([a, b]).map((s) => s.id)).toEqual(['b', 'a'])
    expect(sortSessionsByLatestTimestamp([b, a]).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('sorts a session with an unparseable timestamp as least recent, never first by accident', () => {
    const newest = makeSummary({ id: 'newest', lastTimestamp: '2026-09-09T00:00:00.000Z' })
    const garbage = makeSummary({ id: 'garbage', lastTimestamp: 'not-a-timestamp' })
    const oldest = makeSummary({ id: 'oldest', lastTimestamp: '2026-09-08T00:00:00.000Z' })

    // Deliberately NOT already in the correct order, so a comparator that
    // returns NaN and leaves the input untouched wouldn't accidentally look
    // right.
    expect(sortSessionsByLatestTimestamp([garbage, oldest, newest]).map((s) => s.id)).toEqual([
      'newest',
      'oldest',
      'garbage',
    ])
  })

  it('does not mutate the input array', () => {
    const a = makeSummary({ id: 'a', lastTimestamp: '2026-09-08T00:00:00.000Z' })
    const b = makeSummary({ id: 'b', lastTimestamp: '2026-09-09T00:00:00.000Z' })
    const input = [a, b]

    sortSessionsByLatestTimestamp(input)

    expect(input.map((s) => s.id)).toEqual(['a', 'b'])
  })
})
