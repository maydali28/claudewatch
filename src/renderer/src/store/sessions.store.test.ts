import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ParsedSession, Project, SessionSummary } from '@shared/types'
import type { Result } from '@shared/ipc/contracts'

// Mirrors the mocking pattern in src/main/ipc/settings.handlers.test.ts: mock
// the boundary the store actually calls through (the IPC bridge) rather than
// electron itself.
const mockGetParsed = vi.fn<(...args: unknown[]) => Promise<Result<ParsedSession>>>()
vi.mock('@renderer/lib/ipc-client', () => ({
  ipc: {
    sessions: {
      getParsed: (...args: unknown[]) => mockGetParsed(...args),
    },
  },
}))

import { useSessionsStore, loadingSessionInFlightBySession } from './sessions.store'

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
    serviceTiers: [],
  }
}

function makeProject(id: string, session: SessionSummary): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
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
    liveSessionIds: new Set<string>(),
  })
})

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
