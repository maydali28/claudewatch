import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppPreferences } from '@shared/types/preferences'
import type { Project } from '@shared/types/project'
import type { SessionSummary } from '@shared/types/session'
import type { ScanProjectsResult } from './accounting/worker-protocol'

// scan-cache.ts pulls in `@main/services/accounting/worker-client`, which
// imports `@main/lib/logger` — under vitest's `forks` pool that module sees
// `isMainThread === true` and throws. Mocking the worker client (which we
// need to control anyway, to hold scans open deterministically) sidesteps
// that import chain entirely, per src/main/services/autostart.test.ts:22-27.
const mockScanProjects = vi.fn()
vi.mock('@main/services/accounting/worker-client', () => ({
  accountingWorker: {
    scanProjects: (...args: unknown[]) => mockScanProjects(...args),
  },
}))

const mockGet = vi.fn<() => AppPreferences>()
vi.mock('@main/store/preferences', () => ({
  Preferences: {
    get: () => mockGet(),
  },
}))

const BASE_PREFS: AppPreferences = {
  pricingProvider: 'anthropic',
  pricingOverrides: {},
  secretScanEnabled: false,
  redactionLevel: 'none',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  alertedSecrets: [],
  sentryEnabled: false,
}

/** A controllable promise, so scan resolution order is set explicitly rather than by timing. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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
      pricingModifierResponses: 0,
      serverToolRequests: 0,
    },
    thinkingTokens: 0,
    recordedEffortDistribution: {},
    turnOpen: false,
    serviceTiers: [],
    ...overrides,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj',
    name: 'proj',
    path: '/proj',
    pathResolved: true,
    sessions: [makeSummary()],
    sessionCount: 1,
    localSkills: [],
    localClaudeMd: null,
    ...overrides,
  }
}

function makeScan(projects: Project[]): ScanProjectsResult {
  return { projects }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockReturnValue(BASE_PREFS)
})

describe('ScanCache', () => {
  it('keeps a live update that arrived while a scan was running', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)

    // First scan completes so the cache has a snapshot to patch.
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 1 })] })]))
    await first

    // Second scan starts and is held open; a watcher patch lands mid-scan.
    const scan2 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise)
    const second = cache.refresh()

    await cache.patchSessionSummary(makeSummary({ messageCount: 2 }))

    // Scan resolves with the OLD messageCount, as if read from disk before
    // the patch landed. Without replay, this wholesale-replaces `current`
    // and the patch is lost.
    scan2.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 1 })] })]))
    await second

    const sessions = await cache.getSessionsForProject('proj')
    expect(sessions[0].messageCount).toBe(2)
  })

  it('does not drop a patch that arrives before any scan has completed', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)

    // No scan has ever completed yet: `current` is null.
    const patchPromise = cache.patchSessionSummary(makeSummary({ messageCount: 7 }))

    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 1 })] })]))
    await patchPromise

    const sessions = await cache.getSessionsForProject('proj')
    expect(sessions[0].messageCount).toBe(7)
  })

  it('does not let an older scan overwrite a newer one that already published', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    // Prime the cache so `refresh()` below starts genuinely concurrent scans
    // rather than one of them being served from the empty-cache dedup path.
    const priming = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(priming.promise)
    const primed = cache.refresh()
    priming.resolve(makeScan([makeProject()]))
    await primed

    const older = deferred<ScanProjectsResult>()
    const newer = deferred<ScanProjectsResult>()

    // Differently-priced rates so the two scans get distinct fingerprints
    // and both actually run, rather than the second joining the first.
    mockGet.mockReturnValueOnce(BASE_PREFS)
    mockScanProjects.mockReturnValueOnce(older.promise)
    const olderScan = cache.refresh()

    mockGet.mockReturnValueOnce({
      ...BASE_PREFS,
      pricingOverrides: { 'sonnet-5': { input: 999 } },
    })
    mockScanProjects.mockReturnValueOnce(newer.promise)
    const newerScan = cache.refresh()

    // Newer resolves FIRST and publishes.
    newer.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 42 })] })]))
    await newerScan

    // Older resolves LAST and must not clobber the newer, already-published result.
    older.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 1 })] })]))
    await olderScan

    const sessions = await cache.getSessionsForProject('proj')
    expect(sessions[0].messageCount).toBe(42)
  })

  it('get() never resolves to a falsy value when the non-latest of two racing cold-start scans resolves first', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const older = deferred<ScanProjectsResult>()
    const newer = deferred<ScanProjectsResult>()

    // Cold start: `current` is null and no scan has ever published. `get()`
    // itself triggers the OLDER (non-latest) scan here.
    mockGet.mockReturnValueOnce(BASE_PREFS)
    mockScanProjects.mockReturnValueOnce(older.promise)
    const getPromise = cache.get()

    // A second, differently-priced (so genuinely concurrent, not deduped)
    // caller starts a NEWER scan while the older one is still in flight.
    mockGet.mockReturnValueOnce({
      ...BASE_PREFS,
      pricingOverrides: { 'sonnet-5': { input: 999 } },
    })
    mockScanProjects.mockReturnValueOnce(newer.promise)
    const newerScan = cache.refresh()

    // The non-latest scan resolves FIRST, before anything has published.
    older.resolve(makeScan([makeProject()]))
    const result = await getPromise

    // `get()` must hand back a real snapshot, never null/undefined — this
    // is what pins the "newer than published" gate against a regression to
    // "only the newest-started scan may publish": under that stricter rule
    // the older scan here would publish nothing, and nothing else has
    // published yet either, so `get()` would resolve to null and crash the
    // very next line downstream (`scan.projects.find`) in
    // `getSessionsForProject`.
    expect(result).toBeTruthy()
    expect(result.projects).toBeDefined()

    // Let the newer scan settle so it doesn't leak into other tests.
    newer.resolve(makeScan([makeProject()]))
    await newerScan
  })

  it('shares one scan between concurrent callers using the same pricing table', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan.promise)

    const a = cache.refresh()
    const b = cache.refresh()

    scan.resolve(makeScan([makeProject()]))
    await Promise.all([a, b])

    expect(mockScanProjects).toHaveBeenCalledTimes(1)
  })

  it('inserts a non-newest session at its correct sort position and keeps sessionCount in sync', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)

    const newest = makeSummary({ id: 'newest', lastTimestamp: '2026-01-03T00:00:00.000Z' })
    const oldest = makeSummary({ id: 'oldest', lastTimestamp: '2026-01-01T00:00:00.000Z' })
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [newest, oldest], sessionCount: 2 })]))
    await first

    // Inserted session sits chronologically in the middle — `unshift` would
    // wrongly place it first.
    const middle = makeSummary({ id: 'middle', lastTimestamp: '2026-01-02T00:00:00.000Z' })
    await cache.patchSessionSummary(middle)

    const sessions = await cache.getSessionsForProject('proj')
    expect(sessions.map((s) => s.id)).toEqual(['newest', 'middle', 'oldest'])
    expect(sessions.length).toBe(3)

    const scan = await cache.get()
    expect(scan.projects[0].sessionCount).toBe(3)
  })
})

// Round-1 review finding: `removeSession` mutated only the OUTGOING
// `current`, with no buffered-removal equivalent of `pendingPatches`. A scan
// already in flight when a deletion arrived still resolved with the
// pre-deletion result and `refresh()` swapped it in wholesale, silently
// resurrecting the just-deleted session — exactly the symptom this task
// exists to eliminate, reappearing in the window most likely to occur at
// startup (a cold-start scan racing a watcher-driven deletion).
describe('ScanCache — removeSession', () => {
  it('keeps a removal issued while a scan is in flight absent after that scan publishes', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ id: 's1' })] })]))
    await first

    // Second scan starts and is held open; the transcript is deleted mid-scan.
    const scan2 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise)
    const second = cache.refresh()

    cache.removeSession('proj', 's1')

    // Scan resolves with the STALE pre-deletion result, as if read from disk
    // before the deletion landed. Without buffering the removal the same way
    // a patch is buffered, this wholesale-replaces `current` and resurrects
    // 's1'.
    scan2.resolve(makeScan([makeProject({ sessions: [makeSummary({ id: 's1' })] })]))
    await second

    const sessions = await cache.getSessionsForProject('proj')
    expect(sessions.find((s) => s.id === 's1')).toBeUndefined()
  })

  it('lets a patch that recreates the same id beat an earlier buffered removal', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ id: 's1' })] })]))
    await first

    const scan2 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise)
    const second = cache.refresh()

    // Removed, then recreated with the same id before the in-flight scan lands.
    cache.removeSession('proj', 's1')
    await cache.patchSessionSummary(makeSummary({ id: 's1', messageCount: 99 }))

    scan2.resolve(
      makeScan([makeProject({ sessions: [makeSummary({ id: 's1', messageCount: 1 })] })])
    )
    await second

    const sessions = await cache.getSessionsForProject('proj')
    const recreated = sessions.find((s) => s.id === 's1')
    expect(recreated).toBeDefined()
    expect(recreated?.messageCount).toBe(99)
  })

  it('lets a removal beat an earlier buffered patch for the same id', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ id: 's1' })] })]))
    await first

    const scan2 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise)
    const second = cache.refresh()

    // Patched, then deleted before the in-flight scan lands.
    await cache.patchSessionSummary(makeSummary({ id: 's1', messageCount: 99 }))
    cache.removeSession('proj', 's1')

    scan2.resolve(
      makeScan([makeProject({ sessions: [makeSummary({ id: 's1', messageCount: 1 })] })])
    )
    await second

    const sessions = await cache.getSessionsForProject('proj')
    expect(sessions.find((s) => s.id === 's1')).toBeUndefined()
  })

  it('keeps sessionCount in sync with sessions.length after a removal', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(
      makeScan([
        makeProject({
          sessions: [makeSummary({ id: 's1' }), makeSummary({ id: 's2' })],
          sessionCount: 2,
        }),
      ])
    )
    await first

    cache.removeSession('proj', 's1')

    const scan = await cache.get()
    const project = scan.projects.find((p) => p.id === 'proj')
    expect(project?.sessions.map((s) => s.id)).toEqual(['s2'])
    expect(project?.sessionCount).toBe(project?.sessions.length)
  })

  it('peekProjectSessions reflects the cache without ever triggering a scan', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    // No scan has ever run — peeking must not start one.
    expect(cache.peekProjectSessions('proj')).toEqual([])
    expect(mockScanProjects).not.toHaveBeenCalled()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ id: 's1' })] })]))
    await first

    expect(cache.peekProjectSessions('proj').map((s) => s.id)).toEqual(['s1'])
    expect(mockScanProjects).toHaveBeenCalledTimes(1)
  })
})

/**
 * Fix-round-1 findings 4/5: `project-scanner.ts` merges a git worktree and
 * its main checkout into one `Project` (see `mergeProjectsByResolvedPath`)
 * whose own `id` is only ONE of the physical directories that feed it —
 * every session still carries the real physical directory it was parsed
 * from as its own `projectId` (never rewritten, since that's what locates
 * its file on disk). A file-watcher event for the NON-survivor directory
 * therefore carries a `projectId` that doesn't equal the merged `Project`'s
 * own `id`, so a lookup keyed only on `p.id === physicalProjectId` misses
 * it — forcing an unnecessary full rescan for `applyPatch`, and silently
 * dropping the removal for `applyRemoval`/`peekProjectSessions`.
 */
describe('ScanCache — merged (multi-worktree) projects', () => {
  function makeMergedProject(): Project {
    return makeProject({
      id: 'main-dir',
      sessions: [
        makeSummary({ id: 's-main', projectId: 'main-dir', messageCount: 1 }),
        makeSummary({ id: 's-worktree', projectId: 'worktree-dir', messageCount: 1 }),
      ],
      sessionCount: 2,
    })
  }

  it('applyPatch updates a merged project via a session physically in a non-survivor directory', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const priming = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(priming.promise)
    const primed = cache.refresh()
    priming.resolve(makeScan([makeMergedProject()]))
    await primed

    // Safety net: if the lookup below still can't place the physical
    // directory, `patchSessionSummary` falls back to a full rescan. Queuing
    // one lets a still-broken implementation resolve cleanly (with the
    // STALE messageCount) instead of hanging on an unconsumed mock.
    mockScanProjects.mockReturnValueOnce(Promise.resolve(makeScan([makeMergedProject()])))

    await cache.patchSessionSummary(
      makeSummary({ id: 's-worktree', projectId: 'worktree-dir', messageCount: 99 })
    )

    const sessions = await cache.getSessionsForProject('main-dir')
    expect(sessions.find((s) => s.id === 's-worktree')?.messageCount).toBe(99)
    // The fix applies the patch directly; it must not need the safety-net rescan.
    expect(mockScanProjects).toHaveBeenCalledTimes(1)
    // `vi.clearAllMocks()` in this file's `beforeEach` clears call history but
    // NOT a still-queued `mockReturnValueOnce` — drain it explicitly so an
    // unconsumed safety net never leaks into a later test's own `refresh()`.
    mockScanProjects.mockReset()
  })

  it('peekProjectSessions finds a merged project by a non-survivor physical directory id, scoped to that directory’s own sessions', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const priming = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(priming.promise)
    const primed = cache.refresh()
    priming.resolve(makeScan([makeMergedProject()]))
    await primed

    // handleUnlinkDir calls this with the PHYSICAL directory that vanished —
    // "worktree-dir" here — never the merged survivor id "main-dir". It must
    // return only worktree-dir's own session, not main-dir's too, since the
    // caller rebuilds each session's file path by joining this same
    // physical id with the session's own id.
    const sessions = cache.peekProjectSessions('worktree-dir')

    expect(sessions.map((s) => s.id)).toEqual(['s-worktree'])
  })

  it('removeSession removes a session from a merged project via its non-survivor physical directory id', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const priming = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(priming.promise)
    const primed = cache.refresh()
    priming.resolve(makeScan([makeMergedProject()]))
    await primed

    // handleParentRemoved/removeSession is called with the session's own
    // physical directory, exactly like peekProjectSessions above.
    cache.removeSession('worktree-dir', 's-worktree')

    const sessions = await cache.getSessionsForProject('main-dir')
    expect(sessions.map((s) => s.id)).toEqual(['s-main'])
  })
})

// Task 12 / defect 1: `refresh()`'s replay loop called `applyPatch(result,
// patch)` and discarded the boolean, then cleared `pendingPatches` wholesale
// regardless of the result. `applyPatch` returns false when the summary's
// project isn't in the fresh scan yet (e.g. a brand-new project directory
// the scan started before it existed) — so a patch buffered for exactly that
// reason was thrown away on the very replay meant to apply it, and nothing
// would ever retry it. The direct path in `patchSessionSummary` (no scan in
// flight) already re-buffers on a false return; the replay path did not.
describe('ScanCache — replay does not drop a patch its own scan still cannot place', () => {
  it('keeps a patch buffered when the fresh scan still does not know its project', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ id: 'proj', sessions: [makeSummary()] })]))
    await first

    // Second scan starts (in flight) before the new project's directory is
    // discovered on disk.
    const scan2 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise)
    const second = cache.refresh()

    // A watcher patch lands for a brand-new project while that scan is
    // already running. `this.inFlight` is truthy, so `patchSessionSummary`
    // buffers it rather than applying it directly.
    const patchForNewProject = makeSummary({
      id: 'brand-new',
      projectId: 'proj-new',
      messageCount: 5,
    })
    await cache.patchSessionSummary(patchForNewProject)

    // The in-flight scan resolves with a result from BEFORE the new project
    // was discovered — replaying the patch onto it still can't place it.
    // Queue the next scan's result first: an unplaceable mid-scan patch
    // chains one follow-up scan behind the running one (see
    // `patchSessionSummary`), and that follow-up is what consumes it.
    const scan3 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan3.promise)
    scan2.resolve(makeScan([makeProject({ id: 'proj', sessions: [makeSummary()] })]))
    await second

    // Prove the patch survived (rather than being cleared alongside patches
    // that DID apply) by letting a later scan discover the project and
    // checking the patch replays onto it instead of having vanished. This
    // `refresh()` joins the chained follow-up scan, which is still in flight.
    const third = cache.refresh()
    scan3.resolve(
      makeScan([
        makeProject({ id: 'proj', sessions: [makeSummary()] }),
        makeProject({ id: 'proj-new', path: '/proj-new', sessions: [], sessionCount: 0 }),
      ])
    )
    await third

    const sessions = await cache.getSessionsForProject('proj-new')
    expect(sessions.map((s) => s.id)).toEqual(['brand-new'])
  })
})

// Task 12 / defect 2: `applyPatch`'s insert-sort subtracted two `getTime()`
// results (`new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()`),
// which is `NaN` whenever a `lastTimestamp` is unparsable — a comparator
// that can return `NaN` breaks `Array.prototype.sort`'s contract. This is
// the fifth copy of a bug already fixed via `compareTimestampsAscending` in
// four other places on this branch (projection.ts, project-scanner.ts,
// sort-session-rows.ts, the renderer's sessions.store.ts).
describe('ScanCache — applyPatch sort with an unparsable lastTimestamp', () => {
  it('sorts sessions deterministically when an existing lastTimestamp is unparsable', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)

    // Deliberately NOT already in the correct final order, so a NaN
    // comparator that happens to leave the array untouched wouldn't
    // accidentally look right.
    const garbage = makeSummary({ id: 'garbage', lastTimestamp: 'not-a-timestamp' })
    const oldest = makeSummary({ id: 'oldest', lastTimestamp: '2026-01-01T00:00:00.000Z' })
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [garbage, oldest], sessionCount: 2 })]))
    await first

    const newest = makeSummary({ id: 'newest', lastTimestamp: '2026-01-03T00:00:00.000Z' })
    await cache.patchSessionSummary(newest)

    const sessions = await cache.getSessionsForProject('proj')
    // Descending by time; an unparsable timestamp is never evidence of
    // recency, so it deterministically sorts last — not wherever NaN's
    // comparison semantics happen to leave it.
    expect(sessions.map((s) => s.id)).toEqual(['newest', 'oldest', 'garbage'])
  })
})

describe('ScanCache — a patch is readable while the scan it is buffered against is still running', () => {
  it('get() reflects a watcher patch that landed mid-scan before that scan resolves', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 1 })] })]))
    await first

    // A rescan is in flight (the dashboard sidebar just mounted) and a live
    // session writes. The tray refetches its snapshot on that push and must
    // see the new summary now, not whenever the scan happens to finish.
    const scan2 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise)
    void cache.refresh()
    await cache.patchSessionSummary(makeSummary({ messageCount: 2 }))

    const duringScan = await cache.get()
    expect(duringScan.projects[0].sessions[0].messageCount).toBe(2)

    // And the replay onto the fresh result still holds once the scan lands.
    scan2.resolve(makeScan([makeProject({ sessions: [makeSummary({ messageCount: 1 })] })]))
    await cache.refresh()
    const afterScan = await cache.get()
    expect(afterScan.projects[0].sessions[0].messageCount).toBe(2)
  })
})

describe('ScanCache — a mid-scan patch for a project the in-flight scan cannot place', () => {
  it('schedules one follow-up scan after the in-flight one, so the session does not wait for an unrelated refresh', async () => {
    const { ScanCache } = await import('./scan-cache')
    const cache = new ScanCache()

    const scan1 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan1.promise)
    const first = cache.refresh()
    scan1.resolve(makeScan([makeProject()]))
    await first

    // A long rescan is running; it enumerated project directories before
    // the new worktree directory existed, so its result cannot place the
    // patch either.
    const scan2 = deferred<ScanProjectsResult>()
    const scan3 = deferred<ScanProjectsResult>()
    mockScanProjects.mockReturnValueOnce(scan2.promise).mockReturnValueOnce(scan3.promise)
    const second = cache.refresh()
    const fresh = makeSummary({ id: 'fresh', projectId: 'new-worktree' })
    await cache.patchSessionSummary(fresh)
    scan2.resolve(makeScan([makeProject()]))
    await second
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockScanProjects).toHaveBeenCalledTimes(3)

    scan3.resolve(makeScan([makeProject(), makeProject({ id: 'new-worktree', sessions: [] })]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const sessions = await cache.getSessionsForProject('new-worktree')
    expect(sessions.map((s) => s.id)).toEqual(['fresh'])
  })
})
