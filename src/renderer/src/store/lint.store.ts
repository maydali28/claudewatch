import { create } from 'zustand'
import type { LintResult, LintSummary, LintSeverity } from '@shared/types'
import { ipc } from '@renderer/lib/ipc-client'

interface LintState {
  lintResults: LintResult[]
  lintSummary: LintSummary | null
  severityFilter: LintSeverity | 'all'
  ruleFilter: string
  isRunning: boolean
  lastRunAt: Date | null
  error: string | null

  runLint(projectId?: string): Promise<void>
  setSeverityFilter(s: LintSeverity | 'all'): void
  setRuleFilter(id: string): void
  filteredResults(): LintResult[]
  secrets(): LintResult[]
}

export const useLintStore = create<LintState>((set, get) => ({
  lintResults: [],
  lintSummary: null,
  severityFilter: 'all',
  ruleFilter: '',
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
      set({
        lintResults: runResult.data,
        lintSummary: summaryResult.ok ? summaryResult.data : null,
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

  setRuleFilter(id) {
    set({ ruleFilter: id })
  },

  filteredResults() {
    const { lintResults, severityFilter, ruleFilter } = get()
    return lintResults.filter((r) => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false
      if (ruleFilter && !r.checkId.toLowerCase().includes(ruleFilter.toLowerCase())) return false
      return true
    })
  },

  secrets() {
    return get().lintResults.filter((r) => r.checkId.startsWith('SEC'))
  },
}))
