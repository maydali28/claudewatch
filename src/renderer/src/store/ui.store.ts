import { create } from 'zustand'

export type ViewId =
  | 'analytics'
  | 'sessions'
  | 'plans'
  | 'timeline'
  | 'hooks'
  | 'commands'
  | 'skills'
  | 'mcps'
  | 'memory'
  | 'lint'
  | 'settings'

export type Theme = 'light' | 'dark' | 'system'

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
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'analytics',
  sidebarWidth: 280,
  theme: 'system',
  sourceFilters: {},

  setView(view) {
    set({ activeView: view })
  },

  setSidebarWidth(w) {
    set({ sidebarWidth: Math.max(180, Math.min(400, w)) })
  },

  setTheme(t) {
    set({ theme: t })
  },

  setSourceFilter(view, value) {
    set((s) => ({ sourceFilters: { ...s.sourceFilters, [view]: value } }))
  },
}))
