import { create } from 'zustand'
import type { Project, SessionSummary, ParsedSession } from '@shared/types'
import { SessionCache, compareTimestampsAscending } from '@shared/utils'
import { ipc } from '@renderer/lib/ipc-client'

// Renderer-side LRU of parsed sessions. The main process keeps its own larger
// cache; this one exists so revisiting a session avoids both the IPC round-trip
// and the skeleton flash. Sized small because a single user rarely cycles
// through more than a handful of sessions in one navigation burst.
const rendererSessionCache = new SessionCache(8, 50 * 1024 * 1024)

// Two requests for the SAME session id can resolve out of order (a double
// click, or a background re-validation racing a fresh navigation) — an
// `activeSessionId === sessionId` check alone can't tell them apart, since
// it's true for both regardless of which started first. This counter is
// shared by every code path below that can publish `parsedSession` (the cold
// navigation await, the cached-session background .then(), and the
// push-driven refresh in handleSessionUpdated) so only the most recently
// *started* fetch may ever write it.
let parsedSessionGeneration = 0

// `isLoadingSession`/`isRefreshingSession` are NOT gated by parsedSessionGeneration
// above. That counter is shared across three flows with different flag
// ownership; gating a flag-clear on it would let a fetch belonging to a
// *different* flow supersede one whose flag it doesn't own, stranding that
// flag true forever (nothing else would ever clear it). And leaving them
// gated only by `activeSessionId === sessionId` (the pre-existing check) is
// not enough either: two cold navigations to the same uncached session can
// still resolve out of order, and the earlier one's completion would clear
// isLoadingSession while the later, authoritative one is still in flight —
// producing a blank pane instead of a skeleton.
//
// Instead, track how many requests of each flow are currently outstanding
// and derive the flag from `count > 0`. It rises on every request that
// could still supply data and falls exactly once per request in that
// request's own `finally`, so it can never get stuck true (every request
// settles eventually) and never clears early (as long as ANY request that
// could still supply data is outstanding, the count stays above zero).
//
// `isLoadingSession` gates session-panel.tsx's full skeleton
// (`isLoadingSession || !parsedSession`), so its count is scoped PER SESSION
// ID (`loadingSessionInFlightBySession`) rather than kept as one global
// number. A global count regressed against the pre-fix code: navigating
// A -> B while A's fetch is still outstanding, with B resolving first, left
// the global count at 1 (A's still in flight) even though B's own fetch had
// already resolved and `parsedSession` already held B's correct data —
// re-showing a full skeleton over already-loaded, correct content for
// however long the abandoned A fetch took to drain. The pre-fix code never
// had that window (it cleared unconditionally on `activeSessionId ===
// sessionId`). Scoping the count by session id fixes this while keeping
// every property above: `isLoadingSession` for a GIVEN session still rises
// on every cold-load request for that id and falls exactly once per request
// in its own `finally`.
//
// `isRefreshingSession`, by contrast, is deliberately kept as ONE global
// counter (`refreshingSessionInFlight`) — not an oversight, a narrower
// simplification that's safe specifically because of what this flag drives:
// it only powers a small non-blocking spinner (session-panel.tsx), never the
// skeleton or a blank-state gate. An abandoned session's background refetch
// holding it true slightly longer than strictly necessary for the active
// session has no content-hiding effect, so the extra bookkeeping of a
// per-session map isn't justified here the way it is for isLoadingSession.
//
// Exported only so tests can assert this map doesn't leak entries (an entry
// is deleted once its count reaches zero) — not part of the store's public
// API, and not meant to be read by app code.
export const loadingSessionInFlightBySession = new Map<string, number>()

function bumpLoadingSessionInFlight(sessionId: string, delta: number): number {
  const next = (loadingSessionInFlightBySession.get(sessionId) ?? 0) + delta
  if (next <= 0) loadingSessionInFlightBySession.delete(sessionId)
  else loadingSessionInFlightBySession.set(sessionId, next)
  return next
}

let refreshingSessionInFlight = 0

interface SessionsState {
  projects: Project[]
  activeProjectId: string | null
  activeSessionId: string | null
  parsedSession: ParsedSession | null
  isLoadingProjects: boolean
  /** True only during an explicit user navigation to a session not yet in the renderer cache. Shows skeleton. */
  isLoadingSession: boolean
  /** True during a silent background refresh triggered by a file-watcher push event or cache-hit re-validation. No skeleton. */
  isRefreshingSession: boolean
  sessionError: string | null
  /** Session IDs that received a PUSH_SESSION_UPDATED event during this app session. */
  liveSessionIds: Set<string>

  loadProjects(): Promise<void>
  loadSessionList(projectId: string): Promise<void>
  loadParsedSession(sessionId: string, projectId: string): Promise<void>
  setActiveProject(projectId: string | null): void
  setActiveSession(sessionId: string | null): void
  handleSessionUpdated(summary: SessionSummary): void
  handleSessionCreated(summary: SessionSummary): void
  handleSessionDeleted(payload: { sessionId: string; projectId: string }): void
}

/**
 * Resolves a session's PHYSICAL directory id (the real
 * `~/.claude/projects/<dir>` name — every push event and `session.projectId`
 * carries this, never the merged survivor id, since it's what locates the
 * transcript on disk) to the id of the `Project` that currently owns it.
 *
 * The main process merges a git worktree and its checkout into one `Project`
 * (`project-scanner.ts`'s `mergeProjectsByResolvedPath`) whose own `id` is
 * only ONE of the physical directories that feed it, so a push event for any
 * OTHER merged-in directory needs this fallback — "does an already-known
 * project have a session that physically lives there" — to find its home;
 * `p.id === projectId` alone only matches the survivor's own directory.
 * Returns undefined for a genuinely unknown project (a directory this
 * renderer hasn't loaded sessions for at all yet), same as before this
 * fallback existed.
 */
function findOwningProjectId(projects: Project[], projectId: string): string | undefined {
  return projects.find(
    (p) => p.id === projectId || p.sessions.some((s) => s.projectId === projectId)
  )?.id
}

function updateProjectSessions(
  projects: Project[],
  projectId: string,
  updater: (sessions: SessionSummary[]) => SessionSummary[]
): Project[] {
  const ownerId = findOwningProjectId(projects, projectId) ?? projectId
  return projects.map((p) =>
    p.id === ownerId
      ? { ...p, sessions: updater(p.sessions), sessionCount: updater(p.sessions).length }
      : p
  )
}

// Most-recently-active project first. The renderer can't import the main
// process's copy of this (`@main/services/project-scanner`'s
// `sortProjectsByLatestSession`) — `compareTimestampsAscending` in
// `@shared/utils` is the one piece both processes can share, so both apply
// the same parsed-instant rule instead of comparing `lastTimestamp` text.
function sortProjectsByLatestSession(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const aLatest = a.sessions[0]?.lastTimestamp ?? ''
    const bLatest = b.sessions[0]?.lastTimestamp ?? ''
    return compareTimestampsAscending(bLatest, aLatest)
  })
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  parsedSession: null,
  isLoadingProjects: false,
  isLoadingSession: false,
  isRefreshingSession: false,
  sessionError: null,
  liveSessionIds: new Set<string>(),

  async loadProjects() {
    set({ isLoadingProjects: true, sessionError: null })
    try {
      const result = await ipc.sessions.listProjects()
      if (result.ok) {
        set({ projects: result.data.projects })
      } else {
        set({ sessionError: result.error })
      }
    } catch (err) {
      set({ sessionError: String(err) })
    } finally {
      set({ isLoadingProjects: false })
    }
  },

  async loadSessionList(projectId) {
    const result = await ipc.sessions.getSummaryList(projectId)
    if (result.ok) {
      set((state) => ({
        projects: updateProjectSessions(state.projects, projectId, () => result.data),
      }))
    }
  },

  async loadParsedSession(sessionId, projectId) {
    const state = get()
    const alreadyDisplayed = state.parsedSession?.id === sessionId
    const cached = alreadyDisplayed
      ? state.parsedSession
      : rendererSessionCache.get(projectId, sessionId)

    if (cached) {
      // Two-phase commit so the click feels instant. Phase 1 updates only the
      // selection IDs — cheap to re-render in the sidebar. Phase 2 swaps in
      // the heavy parsedSession on the next frame so the sidebar highlight
      // paints before the panel re-renders hundreds of message bubbles.
      const isSwitchingSession = state.parsedSession?.id !== sessionId
      set({
        activeSessionId: sessionId,
        activeProjectId: projectId,
        sessionError: null,
        isLoadingSession: false,
        isRefreshingSession: true,
      })
      const commitParsed = (): void => {
        if (get().activeSessionId !== sessionId) return
        set({ parsedSession: cached })
      }
      if (isSwitchingSession) requestAnimationFrame(commitParsed)
      else commitParsed()
      const generation = ++parsedSessionGeneration
      refreshingSessionInFlight += 1
      ipc.sessions
        .getParsed(sessionId, projectId)
        .then((result) => {
          // A newer request for this (or another) session started after this
          // one — its eventual publish must win instead.
          if (generation !== parsedSessionGeneration) return
          if (get().activeSessionId !== sessionId) return
          if (result.ok) {
            rendererSessionCache.set(projectId, sessionId, result.data)
            set({ parsedSession: result.data })
          }
        })
        .catch(() => {
          /* non-critical */
        })
        .finally(() => {
          refreshingSessionInFlight = Math.max(0, refreshingSessionInFlight - 1)
          if (get().activeSessionId === sessionId) {
            set({ isRefreshingSession: refreshingSessionInFlight > 0 })
          }
        })
      return
    }

    // Cold navigation — show skeleton until data arrives.
    const generation = ++parsedSessionGeneration
    bumpLoadingSessionInFlight(sessionId, 1)
    set({
      isLoadingSession: true,
      sessionError: null,
      parsedSession: null,
      activeSessionId: sessionId,
      activeProjectId: projectId,
    })
    try {
      const result = await ipc.sessions.getParsed(sessionId, projectId)
      if (generation !== parsedSessionGeneration) return
      if (result.ok) {
        rendererSessionCache.set(projectId, sessionId, result.data)
        if (get().activeSessionId === sessionId) {
          set({ parsedSession: result.data })
        }
      } else {
        if (get().activeSessionId === sessionId) {
          set({ sessionError: result.error })
        }
      }
    } catch (err) {
      if (generation !== parsedSessionGeneration) return
      if (get().activeSessionId === sessionId) {
        set({ sessionError: String(err) })
      }
    } finally {
      const remaining = bumpLoadingSessionInFlight(sessionId, -1)
      if (get().activeSessionId === sessionId) {
        set({ isLoadingSession: remaining > 0 })
      }
    }
  },

  setActiveProject(projectId) {
    set({ activeProjectId: projectId })
  },

  setActiveSession(sessionId) {
    set({ activeSessionId: sessionId })
  },

  handleSessionUpdated(summary) {
    const activeAtEventTime = get().activeSessionId

    set((state) => {
      const updatedProjects = updateProjectSessions(
        state.projects,
        summary.projectId,
        (sessions) => {
          const patched = sessions.map((s) => (s.id === summary.id ? summary : s))
          // Descending by time; swap the arguments into
          // `compareTimestampsAscending` rather than subtracting two
          // `getTime()`s directly, which is `NaN` (and breaks
          // `Array.prototype.sort`'s contract) whenever a `lastTimestamp` is
          // unparsable.
          patched.sort((a, b) => compareTimestampsAscending(b.lastTimestamp, a.lastTimestamp))
          return patched
        }
      )
      const liveSessionIds = new Set(state.liveSessionIds)
      liveSessionIds.add(summary.id)
      return { projects: sortProjectsByLatestSession(updatedProjects), liveSessionIds }
    })

    if (activeAtEventTime !== summary.id) {
      // Stale cached parse for a non-active session — drop it so the next
      // navigation refetches instead of showing outdated content instantly.
      rendererSessionCache.invalidate(summary.projectId, summary.id)
      return
    }

    set({ isRefreshingSession: true })
    const generation = ++parsedSessionGeneration
    refreshingSessionInFlight += 1
    ipc.sessions
      .getParsed(summary.id, summary.projectId)
      .then((result) => {
        // Same session id, but a newer request (another push event, or a
        // fresh navigation) already started — let its result win instead.
        if (generation !== parsedSessionGeneration) return
        if (get().activeSessionId !== summary.id) return
        if (result.ok) {
          rendererSessionCache.set(summary.projectId, summary.id, result.data)
          set({ parsedSession: result.data })
        }
      })
      .catch(() => {
        /* non-critical background refresh */
      })
      .finally(() => {
        refreshingSessionInFlight = Math.max(0, refreshingSessionInFlight - 1)
        if (get().activeSessionId === summary.id) {
          set({ isRefreshingSession: refreshingSessionInFlight > 0 })
        }
      })
  },

  handleSessionCreated(summary) {
    set((state) => {
      // Resolved through `findOwningProjectId`, not a bare `p.id ===`
      // check: a new session's FIRST-EVER file in an already-merged
      // worktree directory would otherwise read as an unknown project (its
      // physical id never equals the merged survivor's) and force a full
      // `loadProjects()` reload for every single new session in that
      // worktree, instead of the cheap in-place update below.
      const ownerId = findOwningProjectId(state.projects, summary.projectId)

      if (!ownerId) {
        get().loadProjects()
        return state
      }

      const updatedProjects = updateProjectSessions(
        state.projects,
        summary.projectId,
        (sessions) => {
          // Same rationale as `handleSessionUpdated`'s sort above: compare
          // parsed instants via `compareTimestampsAscending`, not a raw
          // `getTime()` subtraction that can return `NaN`.
          const updated = [summary, ...sessions].sort((a, b) =>
            compareTimestampsAscending(b.lastTimestamp, a.lastTimestamp)
          )
          return updated
        }
      )

      return { projects: sortProjectsByLatestSession(updatedProjects) }
    })
  },

  handleSessionDeleted({ sessionId, projectId }) {
    rendererSessionCache.invalidate(projectId, sessionId)

    set((state) => {
      const updatedProjects = updateProjectSessions(state.projects, projectId, (sessions) =>
        sessions.filter((s) => s.id !== sessionId)
      )
      const liveSessionIds = new Set(state.liveSessionIds)
      liveSessionIds.delete(sessionId)

      const wasActive = state.activeSessionId === sessionId
      return {
        projects: updatedProjects,
        liveSessionIds,
        // The deleted transcript can no longer be parsed — clear the
        // selection rather than leave the panel showing content for a
        // session that no longer exists on disk.
        activeSessionId: wasActive ? null : state.activeSessionId,
        parsedSession: wasActive ? null : state.parsedSession,
      }
    })
  },
}))
