import { create } from 'zustand'
import type { Project, SessionSummary, ParsedSession } from '@shared/types'
import { SessionCache } from '@shared/utils'
import { ipc } from '@renderer/lib/ipc-client'

// Renderer-side LRU of parsed sessions. The main process keeps its own larger
// cache; this one exists so revisiting a session avoids both the IPC round-trip
// and the skeleton flash. Sized small because a single user rarely cycles
// through more than a handful of sessions in one navigation burst.
const rendererSessionCache = new SessionCache(8, 50 * 1024 * 1024)

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
}

function updateProjectSessions(
  projects: Project[],
  projectId: string,
  updater: (sessions: SessionSummary[]) => SessionSummary[]
): Project[] {
  return projects.map((p) =>
    p.id === projectId
      ? { ...p, sessions: updater(p.sessions), sessionCount: updater(p.sessions).length }
      : p
  )
}

function sortProjectsByLatestSession(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const aLatest = a.sessions[0]?.lastTimestamp ?? ''
    const bLatest = b.sessions[0]?.lastTimestamp ?? ''
    return bLatest.localeCompare(aLatest)
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
    const cached = alreadyDisplayed ? state.parsedSession : rendererSessionCache.get(sessionId)

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
      ipc.sessions
        .getParsed(sessionId, projectId)
        .then((result) => {
          if (get().activeSessionId !== sessionId) return
          if (result.ok) {
            rendererSessionCache.set(sessionId, result.data)
            set({ parsedSession: result.data })
          }
        })
        .catch(() => {
          /* non-critical */
        })
        .finally(() => {
          if (get().activeSessionId === sessionId) set({ isRefreshingSession: false })
        })
      return
    }

    // Cold navigation — show skeleton until data arrives.
    set({
      isLoadingSession: true,
      sessionError: null,
      parsedSession: null,
      activeSessionId: sessionId,
      activeProjectId: projectId,
    })
    try {
      const result = await ipc.sessions.getParsed(sessionId, projectId)
      if (result.ok) {
        rendererSessionCache.set(sessionId, result.data)
        if (get().activeSessionId === sessionId) {
          set({ parsedSession: result.data })
        }
      } else {
        if (get().activeSessionId === sessionId) {
          set({ sessionError: result.error })
        }
      }
    } catch (err) {
      if (get().activeSessionId === sessionId) {
        set({ sessionError: String(err) })
      }
    } finally {
      if (get().activeSessionId === sessionId) {
        set({ isLoadingSession: false })
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
          patched.sort(
            (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
          )
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
      rendererSessionCache.invalidate(summary.id)
      return
    }

    set({ isRefreshingSession: true })
    ipc.sessions
      .getParsed(summary.id, summary.projectId)
      .then((result) => {
        if (get().activeSessionId !== summary.id) return
        if (result.ok) {
          rendererSessionCache.set(summary.id, result.data)
          set({ parsedSession: result.data })
        }
      })
      .catch(() => {
        /* non-critical background refresh */
      })
      .finally(() => {
        if (get().activeSessionId === summary.id) set({ isRefreshingSession: false })
      })
  },

  handleSessionCreated(summary) {
    set((state) => {
      const isKnownProject = state.projects.some((p) => p.id === summary.projectId)

      if (!isKnownProject) {
        get().loadProjects()
        return state
      }

      const updatedProjects = updateProjectSessions(
        state.projects,
        summary.projectId,
        (sessions) => {
          const updated = [summary, ...sessions].sort(
            (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
          )
          return updated
        }
      )

      return { projects: sortProjectsByLatestSession(updatedProjects) }
    })
  },
}))
