import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ParsedSession, Project, SessionSummary } from '@shared/types'
import type { Result } from '@shared/ipc/contracts'

// Mirrors the mocking pattern in src/main/ipc/settings.handlers.test.ts: mock
// the boundary the store actually calls through (the IPC bridge) rather than
// electron itself.
const mockGetParsed = vi.fn<(...args: unknown[]) => Promise<Result<ParsedSession>>>()
const mockListProjects = vi.fn<() => Promise<Result<{ projects: Project[] }>>>()
vi.mock('@renderer/lib/ipc-client', () => ({
  ipc: {
    sessions: {
      getParsed: (...args: unknown[]) => mockGetParsed(...args),
      listProjects: () => mockListProjects(),
    },
  },
}))

import {
  useSessionsStore,
  loadingSessionInFlightBySession,
  shouldAutoLoadProjects,
} from './sessions.store'
import { sessionPanelView } from '@renderer/components/sessions/session-panel-state'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// The cached-session branch's background refetch is fire-and-forget — the
// promise loadParsedSession() returns settles before that .then()/.finally()
// chain does, so awaiting it doesn't observe the chain's effects. A real
// setTimeout(0) round trip flushes past it.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const PROJECT_ID = 'proj-1'

function makeParsedSession(sessionId: string, marker: number): ParsedSession {
  return {
    id: sessionId,
    projectId: PROJECT_ID,
    records: [],
    toolResultMap: {},
    metadata: { marker } as unknown as ParsedSession['metadata'],
    isSubagent: false,
    subagentTotals: { inputTokens: 0, outputTokens: 0, messageCount: 0, estimatedCost: 0 },
    responseUsage: {},
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
  }
}

function ok(data: ParsedSession): Result<ParsedSession> {
  return { ok: true, data }
}

// Minimal fixture for tests that only need a distinct, identifiable
// ParsedSession value (not the marker-based equality `makeParsedSession`
// supports) — thin wrapper so those tests read as "a parsed session for this
// id" rather than reusing an unrelated marker convention.
function fakeParsed(sessionId: string): ParsedSession {
  return makeParsedSession(sessionId, 0)
}

function makeSummary(id: string, projectId: string, lastTimestamp: string): SessionSummary {
  return {
    id,
    projectId,
    projectPath: `/${projectId}`,
    title: id,
    firstTimestamp: lastTimestamp,
    lastTimestamp,
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
    turnOpen: false,
    serviceTiers: [],
  }
}

function makeProject(id: string, session: SessionSummary): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
    pathResolved: true,
    sessions: [session],
    sessionCount: 1,
    localSkills: [],
    localClaudeMd: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionsStore.setState({
    projects: [],
    activeProjectId: null,
    activeSessionId: null,
    parsedSession: null,
    isLoadingProjects: false,
    isLoadingSession: false,
    isRefreshingSession: false,
    sessionError: null,
    projectsError: null,
    projectsLoaded: false,
    liveSessionIds: new Set<string>(),
  })
})

function panelView(): ReturnType<typeof sessionPanelView> {
  const s = useSessionsStore.getState()
  return sessionPanelView({
    activeSessionId: s.activeSessionId,
    isLoadingSession: s.isLoadingSession,
    sessionError: s.sessionError,
    hasParsedSession: s.parsedSession !== null,
  })
}

describe('useSessionsStore — request-generation guard for the same session id', () => {
  it('loads a session normally on an ordinary single request', async () => {
    const sessionId = 'session-ordinary'
    mockGetParsed.mockResolvedValueOnce(ok(makeParsedSession(sessionId, 1)))

    await useSessionsStore.getState().loadParsedSession(sessionId, PROJECT_ID)

    const state = useSessionsStore.getState()
    expect(state.parsedSession?.id).toBe(sessionId)
    expect(state.isLoadingSession).toBe(false)
    expect(state.sessionError).toBeNull()
  })

  it('keeps the newer response when two requests for the SAME session resolve out of order', async () => {
    // A session id not touched by the other test in this file — the renderer
    // session cache is a module-level singleton, so reusing an id would let a
    // cache hit from an earlier test route this through the cached-session
    // branch instead of the cold-navigation branch this test targets.
    const sessionId = 'session-out-of-order'
    const first = deferred<Result<ParsedSession>>()
    const second = deferred<Result<ParsedSession>>()
    mockGetParsed.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const DATA_FIRST = makeParsedSession(sessionId, 1)
    const DATA_SECOND = makeParsedSession(sessionId, 2)

    // Two navigations to the SAME session, e.g. a double click or a rapid
    // back-and-forth. An active-session-id check alone can't tell these apart
    // because both requests share the same session id.
    const firstLoad = useSessionsStore.getState().loadParsedSession(sessionId, PROJECT_ID)
    const secondLoad = useSessionsStore.getState().loadParsedSession(sessionId, PROJECT_ID)

    // The second (later, authoritative) request resolves first...
    second.resolve(ok(DATA_SECOND))
    await secondLoad
    expect(useSessionsStore.getState().parsedSession).toBe(DATA_SECOND)
    // ...but the first (earlier) request is still outstanding. Round-1 review
    // finding: clearing isLoadingSession on an activeSessionId check alone
    // let this exact case flip the skeleton off while the authoritative
    // request was still in flight — a blank pane, not a skeleton.
    expect(useSessionsStore.getState().isLoadingSession).toBe(true)

    // ...then the first (earlier) request resolves last, and must lose the
    // data race but still correctly clear the skeleton once it's the last
    // outstanding request.
    first.resolve(ok(DATA_FIRST))
    await firstLoad

    expect(useSessionsStore.getState().parsedSession).toBe(DATA_SECOND)
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)
    // No leaked per-session entry once both requests for this id have settled.
    expect(loadingSessionInFlightBySession.size).toBe(0)
  })

  // Round-2 review finding: the round-1 fix used a single GLOBAL in-flight
  // count for isLoadingSession, which regressed a different case than the
  // one it fixed. Cold-navigate A -> B while A's fetch is still outstanding;
  // B (the new active session) resolves first and its data lands correctly,
  // but the global count was still 1 (A's fetch not yet drained), so
  // isLoadingSession stayed true — re-showing a full skeleton
  // (session-panel.tsx gates it on `isLoadingSession || !parsedSession`)
  // over B's already-correct content until A's abandoned fetch also
  // resolved. The pre-round-1 code never had this window: it cleared
  // isLoadingSession unconditionally once `activeSessionId === sessionId`.
  it('does not re-show the skeleton over a different, already-loaded session when an abandoned fetch is still outstanding', async () => {
    const sessionA = 'session-cross-a'
    const sessionB = 'session-cross-b'
    const aFetch = deferred<Result<ParsedSession>>()
    const bFetch = deferred<Result<ParsedSession>>()
    mockGetParsed.mockReturnValueOnce(aFetch.promise).mockReturnValueOnce(bFetch.promise)

    const DATA_B = makeParsedSession(sessionB, 1)

    // Navigate to A, then immediately away to B, before A's fetch resolves.
    const loadA = useSessionsStore.getState().loadParsedSession(sessionA, PROJECT_ID)
    const loadB = useSessionsStore.getState().loadParsedSession(sessionB, PROJECT_ID)

    // B, the now-active session, resolves first...
    bFetch.resolve(ok(DATA_B))
    await loadB

    expect(useSessionsStore.getState().parsedSession).toBe(DATA_B)
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)

    // ...then A (abandoned — the user is no longer looking at it) resolves
    // last and must not disturb B's already-settled state.
    aFetch.resolve(ok(makeParsedSession(sessionA, 0)))
    await loadA

    expect(useSessionsStore.getState().parsedSession).toBe(DATA_B)
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)
    // No leaked per-session entries once every outstanding request, active
    // or abandoned, has settled.
    expect(loadingSessionInFlightBySession.size).toBe(0)
  })

  // Round-1 review finding: isRefreshingSession has the identical hole as
  // isLoadingSession, one level removed — it's shared by the cached-session
  // background refetch AND handleSessionUpdated's push-driven refetch. This
  // test exercises the former: two overlapping background re-validations for
  // a session already on screen (both take the cached branch, since the
  // session is already displayed — no requestAnimationFrame needed).
  it('does not clear isRefreshingSession while a newer background refetch for the same session is still pending', async () => {
    const sessionId = 'session-background-refresh'
    useSessionsStore.setState({
      activeSessionId: sessionId,
      activeProjectId: PROJECT_ID,
      parsedSession: makeParsedSession(sessionId, 0),
    })

    const first = deferred<Result<ParsedSession>>()
    const second = deferred<Result<ParsedSession>>()
    mockGetParsed.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const DATA_FIRST = makeParsedSession(sessionId, 1)
    const DATA_SECOND = makeParsedSession(sessionId, 2)

    await useSessionsStore.getState().loadParsedSession(sessionId, PROJECT_ID)
    await useSessionsStore.getState().loadParsedSession(sessionId, PROJECT_ID)

    second.resolve(ok(DATA_SECOND))
    await flushAsync()
    expect(useSessionsStore.getState().parsedSession).toBe(DATA_SECOND)
    expect(useSessionsStore.getState().isRefreshingSession).toBe(true)

    first.resolve(ok(DATA_FIRST))
    await flushAsync()
    expect(useSessionsStore.getState().parsedSession).toBe(DATA_SECOND)
    expect(useSessionsStore.getState().isRefreshingSession).toBe(false)
  })
})

describe('useSessionsStore — a deleted session resets its own loading state', () => {
  it('a session deleted while its cold load is in flight does not leave isLoadingSession stuck', async () => {
    let resolveParsed!: (v: Result<ParsedSession>) => void
    mockGetParsed.mockReturnValueOnce(
      new Promise((r) => {
        resolveParsed = r
      })
    )
    const p = useSessionsStore.getState().loadParsedSession('s1', PROJECT_ID)
    expect(useSessionsStore.getState().isLoadingSession).toBe(true)

    useSessionsStore.getState().handleSessionDeleted({ sessionId: 's1', projectId: PROJECT_ID })
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)
    expect(useSessionsStore.getState().sessionError).toBeNull()

    resolveParsed(ok(fakeParsed('s1')))
    await p

    expect(useSessionsStore.getState().activeSessionId).toBeNull()
    // Late result for a deleted session is dropped.
    expect(useSessionsStore.getState().parsedSession).toBeNull()
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)
  })

  it('a failed cold load leaves sessionError set and isLoadingSession false', async () => {
    mockGetParsed.mockResolvedValueOnce({ ok: false, error: 'transcript unreadable' })

    await useSessionsStore.getState().loadParsedSession('s2', PROJECT_ID)

    expect(useSessionsStore.getState()).toMatchObject({
      isLoadingSession: false,
      sessionError: 'transcript unreadable',
      parsedSession: null,
    })
  })

  // Round-2 review finding 2: the map itself already stays non-negative
  // (`bumpLoadingSessionInFlight`'s pre-existing `if (next <= 0) delete`
  // branch), so asserting on `loadingSessionInFlightBySession` directly
  // isn't an observable regression check — it can't fail. What CAN actually
  // regress is `isLoadingSession` itself: if closeActiveSession doesn't
  // drain the counter, a real, later, fully-completed load of the SAME
  // session can inherit the abandoned request's leftover "+1" and get
  // stuck showing the skeleton until that abandoned request also happens to
  // settle (which may be never).
  it('a stale finally after closeActiveSession does not leave a phantom in-flight count that blocks a later real load of the same session from clearing isLoadingSession', async () => {
    let resolveStale!: (v: Result<ParsedSession>) => void
    mockGetParsed.mockReturnValueOnce(
      new Promise((r) => {
        resolveStale = r
      })
    )
    const stale = useSessionsStore.getState().loadParsedSession('reset-drain', PROJECT_ID)
    expect(useSessionsStore.getState().isLoadingSession).toBe(true)

    // The user gives up on this in-flight load ("Back to sessions") before
    // the request itself has settled.
    useSessionsStore.getState().closeActiveSession()
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)

    // A fresh, real cold load for the SAME session starts while the first
    // one is still abandoned in flight (e.g. the user retries) and runs to
    // completion before the abandoned one settles.
    mockGetParsed.mockResolvedValueOnce(ok(fakeParsed('reset-drain')))
    const fresh = useSessionsStore.getState().loadParsedSession('reset-drain', PROJECT_ID)
    await fresh

    // The fresh load fully completed — isLoadingSession must reflect that,
    // not an undrained leftover count from the abandoned first request.
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)

    // The abandoned first request finally settles, late. It must not flip
    // isLoadingSession back on.
    resolveStale(ok(fakeParsed('reset-drain')))
    await stale
    expect(useSessionsStore.getState().isLoadingSession).toBe(false)
  })
})

describe('useSessionsStore — handleSessionDeleted only affects the session it names', () => {
  it('deleting a non-active session while another session is loading leaves the active session loading', async () => {
    let resolveActive!: (v: Result<ParsedSession>) => void
    mockGetParsed.mockReturnValueOnce(
      new Promise((r) => {
        resolveActive = r
      })
    )
    const active = useSessionsStore.getState().loadParsedSession('del-active-a', PROJECT_ID)
    expect(useSessionsStore.getState().isLoadingSession).toBe(true)

    useSessionsStore
      .getState()
      .handleSessionDeleted({ sessionId: 'del-inactive-b', projectId: PROJECT_ID })

    expect(useSessionsStore.getState().activeSessionId).toBe('del-active-a')
    expect(useSessionsStore.getState().isLoadingSession).toBe(true)

    resolveActive(ok(fakeParsed('del-active-a')))
    await active
  })
})

/**
 * The sidebar's project order used to have a FOURTH copy of the
 * lexical-comparison defect fixed elsewhere (accounting projection's "latest
 * model" badge, the Overview table's "Last active" sort, and the main
 * process's own project-scanner ordering): this store keeps its own
 * `sortProjectsByLatestSession`, called on every live push event
 * (`handleSessionUpdated`/`handleSessionCreated`), and it compared raw
 * `lastTimestamp` text with `.localeCompare` instead of parsed instants. That
 * made this the MORE frequently exercised path of the two — the initial scan
 * (fixed via `@main/services/project-scanner`) only runs once per launch;
 * these run on every push while a session is active.
 */
describe('useSessionsStore — project ordering on live updates compares instants, not text', () => {
  it('handleSessionUpdated reorders projects correctly when timestamps carry mixed offsets', () => {
    // '+02:00' names the instant 2026-09-13T22:30:00Z — earlier than proj-b's
    // 'Z' timestamp below — but as raw text it sorts AFTER it, which is
    // exactly what a lexical comparison gets backwards.
    const projA = makeProject('proj-a', makeSummary('s-a', 'proj-a', '2026-09-14T00:30:00+02:00'))
    const projB = makeProject('proj-b', makeSummary('s-b', 'proj-b', '2026-09-13T23:00:00Z'))
    useSessionsStore.setState({ projects: [projA, projB] })

    // A live push updates proj-a's session (title only — the timestamp is
    // unchanged) and triggers the store's project re-sort as a side effect.
    useSessionsStore.getState().handleSessionUpdated({ ...projA.sessions[0], title: 'updated' })

    expect(useSessionsStore.getState().projects.map((p) => p.id)).toEqual(['proj-b', 'proj-a'])
  })

  it('handleSessionCreated reorders projects correctly when timestamps carry mixed offsets', () => {
    const projA = makeProject('proj-a', makeSummary('s-a', 'proj-a', '2026-09-13T23:00:00Z'))
    const projB = makeProject('proj-b', makeSummary('s-b', 'proj-b', '2026-01-01T00:00:00Z'))
    useSessionsStore.setState({ projects: [projA, projB] })

    // A new session lands in proj-b with an offset timestamp naming an
    // instant earlier than proj-a's 'Z' timestamp, but sorting later as text.
    useSessionsStore
      .getState()
      .handleSessionCreated(makeSummary('s-b2', 'proj-b', '2026-09-14T00:30:00+02:00'))

    expect(useSessionsStore.getState().projects.map((p) => p.id)).toEqual(['proj-a', 'proj-b'])
  })

  it('all-Z corpus orders correctly (regression pin)', () => {
    const projA = makeProject('proj-a', makeSummary('s-a', 'proj-a', '2026-09-08T00:00:00.000Z'))
    const projB = makeProject('proj-b', makeSummary('s-b', 'proj-b', '2026-09-09T00:00:00.000Z'))
    useSessionsStore.setState({ projects: [projA, projB] })

    useSessionsStore.getState().handleSessionUpdated({ ...projA.sessions[0], title: 'updated' })

    expect(useSessionsStore.getState().projects.map((p) => p.id)).toEqual(['proj-b', 'proj-a'])
  })
})

/**
 * `handleSessionUpdated` and `handleSessionCreated` also re-sort a single
 * project's OWN session list (not just the sidebar's project order, fixed
 * above) on every live push, via the same raw `getTime()` subtraction the
 * project-order sort used to use before it was fixed — this is that same
 * defect's live twin, still present in this file after that fix.
 */
describe('useSessionsStore — session-list ordering is NaN-safe on live updates', () => {
  it('handleSessionUpdated re-sorts a project session list without going NaN-order when one entry is unparsable', () => {
    const garbage = makeSummary('garbage', PROJECT_ID, 'not-a-timestamp')
    const mid = makeSummary('mid', PROJECT_ID, '2026-01-02T00:00:00.000Z')
    const oldest = makeSummary('oldest', PROJECT_ID, '2026-01-01T00:00:00.000Z')
    const project: Project = {
      id: PROJECT_ID,
      name: PROJECT_ID,
      path: `/${PROJECT_ID}`,
      pathResolved: true,
      sessions: [garbage, mid, oldest],
      sessionCount: 3,
      localSkills: [],
      localClaudeMd: null,
    }
    useSessionsStore.setState({ projects: [project] })

    // 'mid' becomes the most recent session in the project.
    useSessionsStore
      .getState()
      .handleSessionUpdated(makeSummary('mid', PROJECT_ID, '2026-01-05T00:00:00.000Z'))

    const sessionIds = useSessionsStore
      .getState()
      .projects.find((p) => p.id === PROJECT_ID)
      ?.sessions.map((s) => s.id)
    // Descending by time; the unparsable one is never evidence of recency
    // and must sort last, deterministically — not wherever a NaN comparator
    // happens to leave it.
    expect(sessionIds).toEqual(['mid', 'oldest', 'garbage'])
  })

  it('handleSessionCreated inserts and re-sorts a project session list without going NaN-order when one entry is unparsable', () => {
    const garbage = makeSummary('garbage', PROJECT_ID, 'not-a-timestamp')
    const oldest = makeSummary('oldest', PROJECT_ID, '2026-01-01T00:00:00.000Z')
    const project: Project = {
      id: PROJECT_ID,
      name: PROJECT_ID,
      path: `/${PROJECT_ID}`,
      pathResolved: true,
      sessions: [garbage, oldest],
      sessionCount: 2,
      localSkills: [],
      localClaudeMd: null,
    }
    useSessionsStore.setState({ projects: [project] })

    useSessionsStore
      .getState()
      .handleSessionCreated(makeSummary('newest', PROJECT_ID, '2026-01-05T00:00:00.000Z'))

    const sessionIds = useSessionsStore
      .getState()
      .projects.find((p) => p.id === PROJECT_ID)
      ?.sessions.map((s) => s.id)
    expect(sessionIds).toEqual(['newest', 'oldest', 'garbage'])
  })
})

/**
 * Fix-round-1 finding 4/5: a project merged from several worktrees
 * (`project-scanner.ts`'s `mergeProjectsByResolvedPath`) has a survivor `id`
 * that is only ONE of the physical directories feeding it. Every live push
 * event still carries the session's own PHYSICAL directory as its
 * `projectId` (never rewritten — it locates the transcript on disk), so a
 * push for a session in a NON-survivor directory used to find no matching
 * project in `updateProjectSessions`'s `p.id === projectId` check and
 * silently no-op, leaving the sidebar stale until the next full reload.
 */
describe('useSessionsStore — live updates find a merged project by its physical directory id', () => {
  function makeMergedProject(): Project {
    return {
      id: 'main-dir',
      name: 'merged',
      path: '/merged',
      pathResolved: true,
      sessions: [
        makeSummary('s-main', 'main-dir', '2026-09-10T00:00:00.000Z'),
        makeSummary('s-worktree', 'worktree-dir', '2026-09-09T00:00:00.000Z'),
      ],
      sessionCount: 2,
      localSkills: [],
      localClaudeMd: null,
    }
  }

  it('handleSessionUpdated updates a session in the merged project even though the event carries a different (non-survivor) physical projectId', () => {
    useSessionsStore.setState({ projects: [makeMergedProject()] })

    useSessionsStore.getState().handleSessionUpdated({
      ...makeSummary('s-worktree', 'worktree-dir', '2026-09-09T00:00:00.000Z'),
      messageCount: 99,
    })

    const project = useSessionsStore.getState().projects.find((p) => p.id === 'main-dir')
    expect(project?.sessions.find((s) => s.id === 's-worktree')?.messageCount).toBe(99)
  })

  it('handleSessionDeleted removes a session from the merged project even though the payload carries its physical projectId', () => {
    useSessionsStore.setState({ projects: [makeMergedProject()] })

    useSessionsStore.getState().handleSessionDeleted({
      sessionId: 's-worktree',
      projectId: 'worktree-dir',
    })

    const project = useSessionsStore.getState().projects.find((p) => p.id === 'main-dir')
    expect(project?.sessions.map((s) => s.id)).toEqual(['s-main'])
    expect(project?.sessionCount).toBe(1)
  })

  it('handleSessionCreated adds a new session to the merged project when it arrives under an already-known non-survivor physical projectId', () => {
    useSessionsStore.setState({ projects: [makeMergedProject()] })

    useSessionsStore
      .getState()
      .handleSessionCreated(
        makeSummary('s-worktree-new', 'worktree-dir', '2026-09-11T00:00:00.000Z')
      )

    const project = useSessionsStore.getState().projects.find((p) => p.id === 'main-dir')
    expect(project?.sessions.map((s) => s.id)).toEqual(['s-worktree-new', 's-main', 's-worktree'])
    expect(project?.sessionCount).toBe(3)
  })
})

describe('useSessionsStore — an update push for a project this renderer has not loaded', () => {
  it('reloads the project list instead of silently dropping the session', async () => {
    const known = makeSummary('s-known', 'known', '2026-09-16T09:00:00.000Z')
    useSessionsStore.setState({ projects: [makeProject('known', known)] })
    mockListProjects.mockResolvedValue({ ok: true, data: { projects: [] } })

    // Same shape `handleSessionCreated` already handles; an update can arrive
    // first when the create push was missed (e.g. it landed during a reload).
    useSessionsStore
      .getState()
      .handleSessionUpdated(makeSummary('s-new', 'brand-new-project', '2026-09-16T09:05:00.000Z'))
    await flushAsync()

    expect(mockListProjects).toHaveBeenCalledTimes(1)
  })

  it('does not start a second reload while the first is still in flight', async () => {
    const known = makeSummary('s-known', 'known', '2026-09-16T09:00:00.000Z')
    useSessionsStore.setState({ projects: [makeProject('known', known)] })
    const load = deferred<Result<{ projects: Project[] }>>()
    mockListProjects.mockReturnValue(load.promise)

    // A streaming session in a brand-new project pushes every few hundred ms;
    // each push before the first reload resolves must not queue another
    // full rescan and full-payload IPC round trip.
    const store = useSessionsStore.getState()
    store.handleSessionUpdated(makeSummary('s-new', 'new-project', '2026-09-16T09:05:00.000Z'))
    store.handleSessionUpdated(makeSummary('s-new', 'new-project', '2026-09-16T09:05:01.000Z'))
    store.handleSessionUpdated(makeSummary('s-new', 'new-project', '2026-09-16T09:05:02.000Z'))
    await flushAsync()

    expect(mockListProjects).toHaveBeenCalledTimes(1)
    load.resolve({ ok: true, data: { projects: [] } })
  })

  it('does not reload when the project is already known', async () => {
    const known = makeSummary('s-known', 'known', '2026-09-16T09:00:00.000Z')
    useSessionsStore.setState({ projects: [makeProject('known', known)] })
    mockListProjects.mockResolvedValue({ ok: true, data: { projects: [] } })

    useSessionsStore
      .getState()
      .handleSessionUpdated(makeSummary('s-known', 'known', '2026-09-16T09:05:00.000Z'))
    await flushAsync()

    expect(mockListProjects).not.toHaveBeenCalled()
  })
})

// ─── A conversation's load error vs. the project list ────────────────────────
//
// `sessionError` used to be shared with project loading. `loadProjects()`
// began with `sessionError: null`, and the sidebar calls it on every mount —
// the middle sidebar remounts on every view switch — and on every push for an
// unknown project. So after a failed conversation load, switching to
// Analytics and back wiped the error, `sessionPanelView` fell through to
// 'loading', and the endless skeleton this branch set out to fix came back.
// The sidebar also showed that transcript's error under "Failed to load
// projects".

describe('useSessionsStore — a conversation load error survives a project reload', () => {
  it('keeps sessionError and the error view when the project list reloads', async () => {
    mockGetParsed.mockResolvedValueOnce({ ok: false, error: 'transcript unreadable' })
    await useSessionsStore.getState().loadParsedSession('err-survives', PROJECT_ID)
    expect(panelView()).toBe('error')

    mockListProjects.mockResolvedValueOnce({ ok: true, data: { projects: [] } })
    await useSessionsStore.getState().loadProjects()

    expect(useSessionsStore.getState().sessionError).toBe('transcript unreadable')
    expect(panelView()).toBe('error')
  })

  it('reports a failed project list in projectsError only', async () => {
    mockListProjects.mockResolvedValueOnce({ ok: false, error: 'scan failed' })
    await useSessionsStore.getState().loadProjects()

    expect(useSessionsStore.getState()).toMatchObject({
      projectsError: 'scan failed',
      sessionError: null,
      isLoadingProjects: false,
    })
  })

  it('reports a thrown project list load in projectsError only', async () => {
    mockListProjects.mockRejectedValueOnce(new Error('bridge gone'))
    await useSessionsStore.getState().loadProjects()

    expect(useSessionsStore.getState().projectsError).toContain('bridge gone')
    expect(useSessionsStore.getState().sessionError).toBeNull()
  })

  it('clears projectsError once the project list loads again', async () => {
    useSessionsStore.setState({ projectsError: 'scan failed' })
    mockListProjects.mockResolvedValueOnce({ ok: true, data: { projects: [] } })
    await useSessionsStore.getState().loadProjects()

    expect(useSessionsStore.getState().projectsError).toBeNull()
  })

  it('leaves a project list error alone when a conversation loads', async () => {
    useSessionsStore.setState({ projectsError: 'scan failed' })
    mockGetParsed.mockResolvedValueOnce(ok(fakeParsed('loads-fine')))
    await useSessionsStore.getState().loadParsedSession('loads-fine', PROJECT_ID)

    expect(useSessionsStore.getState().projectsError).toBe('scan failed')
  })
})

describe('useSessionsStore — closeActiveSession ("Back to sessions")', () => {
  it('clears the error along with the selection, so the panel is empty rather than stuck on the error', async () => {
    mockGetParsed.mockResolvedValueOnce({ ok: false, error: 'transcript unreadable' })
    await useSessionsStore.getState().loadParsedSession('err-back', PROJECT_ID)
    expect(panelView()).toBe('error')

    useSessionsStore.getState().closeActiveSession()

    expect(useSessionsStore.getState()).toMatchObject({
      activeSessionId: null,
      sessionError: null,
      isLoadingSession: false,
    })
    expect(panelView()).toBe('empty')
  })

  it('does not carry the old error into the next conversation that is still loading', async () => {
    mockGetParsed.mockResolvedValueOnce({ ok: false, error: 'transcript unreadable' })
    await useSessionsStore.getState().loadParsedSession('err-then-next', PROJECT_ID)
    useSessionsStore.getState().closeActiveSession()

    const next = deferred<Result<ParsedSession>>()
    mockGetParsed.mockReturnValueOnce(next.promise)
    const loading = useSessionsStore.getState().loadParsedSession('next-one', PROJECT_ID)
    expect(panelView()).toBe('loading')

    next.resolve(ok(fakeParsed('next-one')))
    await loading
    expect(panelView()).toBe('content')
  })
})

// ─── Auto-loading the project list ──────────────────────────────────────────
//
// The Analytics sidebar loads the project list on mount when nothing has been
// loaded yet. It used to test "the list is empty, nothing is loading, no
// error" — which is exactly the state a successful scan of an empty profile
// ends in, and the `isLoadingProjects` flip re-ran its effect: an endless
// rescan loop on a machine with no projects.

describe('shouldAutoLoadProjects', () => {
  it('loads when nothing has been loaded and nothing is loading', () => {
    expect(shouldAutoLoadProjects({ projectsLoaded: false, isLoadingProjects: false })).toBe(true)
  })

  it('does not load while a load is in flight', () => {
    expect(shouldAutoLoadProjects({ projectsLoaded: false, isLoadingProjects: true })).toBe(false)
  })

  it('does not load again once a load has completed, even with no projects', () => {
    expect(shouldAutoLoadProjects({ projectsLoaded: true, isLoadingProjects: false })).toBe(false)
  })
})

describe('useSessionsStore — an empty project list settles after one load', () => {
  // Stands in for the sidebar's effect: re-evaluated on every store change,
  // loading whenever the rule says so. Capped so a regression fails instead
  // of hanging the run.
  async function runAutoLoader(): Promise<void> {
    let calls = 0
    const maybeLoad = (): void => {
      if (calls >= 5) return
      if (shouldAutoLoadProjects(useSessionsStore.getState())) {
        calls += 1
        void useSessionsStore.getState().loadProjects()
      }
    }
    const unsubscribe = useSessionsStore.subscribe(maybeLoad)
    maybeLoad()
    for (let i = 0; i < 10; i += 1) await flushAsync()
    unsubscribe()
  }

  it('marks the list loaded after an empty successful scan and does not scan again', async () => {
    mockListProjects.mockResolvedValue({ ok: true, data: { projects: [] } })

    await runAutoLoader()

    expect(mockListProjects).toHaveBeenCalledTimes(1)
    expect(useSessionsStore.getState()).toMatchObject({
      projects: [],
      projectsLoaded: true,
      isLoadingProjects: false,
      projectsError: null,
    })
  })

  it('marks the list loaded after a failed scan and does not retry on its own', async () => {
    mockListProjects.mockResolvedValue({ ok: false, error: 'scan failed' })

    await runAutoLoader()

    expect(mockListProjects).toHaveBeenCalledTimes(1)
    expect(useSessionsStore.getState().projectsLoaded).toBe(true)
  })

  it('still scans when refreshed by hand after an empty load', async () => {
    mockListProjects.mockResolvedValue({ ok: true, data: { projects: [] } })
    await runAutoLoader()

    await useSessionsStore.getState().loadProjects()

    expect(mockListProjects).toHaveBeenCalledTimes(2)
  })
})
