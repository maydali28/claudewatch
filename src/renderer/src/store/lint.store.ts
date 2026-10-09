import { create } from 'zustand'
import type { LintResult, LintSummary } from '@shared/types'
import { ipc } from '@renderer/lib/ipc-client'
import type { SeverityFilter } from '@renderer/components/lint/health-view'

interface LintState {
  lintResults: LintResult[]
  lintSummary: LintSummary | null
  severityFilter: SeverityFilter
  /** Sidebar filter text, matched against check id, message, area and path. */
  search: string
  /** The result open in the main panel; null shows the overview. */
  selectedResultId: string | null
  isRunning: boolean
  lastRunAt: Date | null
  error: string | null

  runLint(projectId?: string): Promise<void>
  setSeverityFilter(s: SeverityFilter): void
  setSearch(text: string): void
  setSelectedResult(id: string | null): void
}

export const useLintStore = create<LintState>((set, get) => ({
  lintResults: [],
  lintSummary: null,
  severityFilter: 'all',
  search: '',
  selectedResultId: null,
  isRunning: false,
  lastRunAt: null,
  error: null,

  async runLint(projectId) {
    set({ isRunning: true, error: null })
    try {
      const runResult = await ipc.lint.run(projectId)
      if (!runResult.ok) {
        set({ error: runResult.error })
        return
      }
      const summaryResult = await ipc.lint.getSummary()
      // Result ids are new on every run; keep the selection only if the same
      // check on the same target is still failing.
      const prev = get().lintResults.find((r) => r.id === get().selectedResultId)
      const same = prev
        ? runResult.data.find(
            (r) =>
              r.checkId === prev.checkId &&
              r.filePath === prev.filePath &&
              r.message === prev.message
          )
        : undefined
      set({
        lintResults: runResult.data,
        lintSummary: summaryResult.ok ? summaryResult.data : null,
        selectedResultId: same?.id ?? null,
        lastRunAt: new Date(),
      })
    } catch (err) {
      set({ error: String(err) })
    } finally {
      set({ isRunning: false })
    }
  },

  setSeverityFilter(s) {
    set({ severityFilter: s })
  },

  setSearch(text) {
    set({ search: text })
  },

  setSelectedResult(id) {
    set({ selectedResultId: id })
  },
}))
