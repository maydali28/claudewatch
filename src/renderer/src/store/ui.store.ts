import { create } from 'zustand'

export type ViewId =
  | 'analytics'
  | 'sessions'
  | 'plans'
  | 'hooks'
  | 'commands'
  | 'skills'
  | 'plugins'
  | 'mcps'
  | 'memory'
  | 'lint'
  | 'settings'

export type Theme = 'light' | 'dark' | 'system'

/** Overview is the conversation with its details panel; the others replace the conversation. */
export type SessionTab = 'overview' | 'subagents' | 'tools' | 'health'

interface UIState {
  activeView: ViewId
  sidebarWidth: number
  theme: Theme
  /** Source chip chosen in each setup sidebar, keyed by view; kept while the app runs, like the sidebar width. */
  sourceFilters: Partial<Record<ViewId, string>>
  setView(view: ViewId): void
  setSidebarWidth(w: number): void
  setTheme(t: Theme): void
  setSourceFilter(view: ViewId, value: string): void
  /**
   * A tab to show once the given session is open: set by a link that opens a
   * session somewhere specific (a health badge, a Health view row), consumed
   * by the session panel.
   */
  sessionTabRequest: { sessionId: string; tab: SessionTab } | null
  requestSessionTab(sessionId: string, tab: SessionTab): void
  clearSessionTabRequest(): void
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'analytics',
  sidebarWidth: 280,
  theme: 'system',
  sourceFilters: {},
  sessionTabRequest: null,

  setView(view) {
    set({ activeView: view })
  },

  setSidebarWidth(w) {
    set({ sidebarWidth: Math.max(180, Math.min(400, w)) })
  },

  setTheme(t) {
    set({ theme: t })
  },

  requestSessionTab(sessionId, tab) {
    set({ sessionTabRequest: { sessionId, tab } })
  },

  clearSessionTabRequest() {
    set({ sessionTabRequest: null })
  },

  setSourceFilter(view, value) {
    set((s) => ({ sourceFilters: { ...s.sourceFilters, [view]: value } }))
  },
}))
