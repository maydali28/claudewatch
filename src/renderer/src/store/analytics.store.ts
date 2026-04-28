import { create } from 'zustand'
import type { AnalyticsData, DateRange } from '@shared/types'
import { ipc } from '@renderer/lib/ipc-client'

const CACHE_TTL_MS = 60_000

interface AnalyticsState {
  analyticsData: AnalyticsData | null
  // Loaded once per date-range change (no project filter), used for sidebar totals
  baselineData: AnalyticsData | null
  lastFetchedAt: number | null
  dateRange: DateRange
  selectedProjectIds: string[]
  isLoading: boolean
  error: string | null

  setDateRange(range: DateRange): void
  setProjectFilter(ids: string[]): void
  refresh(force?: boolean): Promise<void>
  /** Mark analytics as stale so the next refresh() call re-fetches even within TTL. */
  invalidate(): void
}

async function fetchAnalytics(dateRange: DateRange, projectIds?: string[]): Promise<AnalyticsData> {
  const result = await ipc.analytics.get({ dateRange, projectIds })
  if (result.ok) return result.data
  throw new Error(result.error)
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  analyticsData: null,
  baselineData: null,
  lastFetchedAt: null,
  dateRange: '7d',
  selectedProjectIds: [],
  isLoading: false,
  error: null,

  setDateRange(range) {
    // Date range change resets baseline — refetch both
    set({ dateRange: range, baselineData: null, lastFetchedAt: null })
    get().refresh(true)
  },

  setProjectFilter(ids) {
    set({ selectedProjectIds: ids })
    // Only re-fetch filtered data, baseline stays unchanged
    const { dateRange, baselineData } = get()
    if (ids.length === 0) {
      // Going back to "all" — reuse baseline as main data if available
      if (baselineData) {
        set({ analyticsData: baselineData })
        return
      }
    }
    set({ isLoading: true, error: null })
    fetchAnalytics(dateRange, ids.length > 0 ? ids : undefined)
      .then((data) => set({ analyticsData: data }))
      .catch((err) => set({ error: String(err) }))
      .finally(() => set({ isLoading: false }))
  },

  invalidate() {
    set({ lastFetchedAt: null })
  },

  async refresh(force = false) {
    const { lastFetchedAt, analyticsData } = get()
    const isStale = !lastFetchedAt || Date.now() - lastFetchedAt > CACHE_TTL_MS
    if (!force && analyticsData && !isStale) return

    set({ isLoading: true, error: null })
    try {
      const { dateRange, selectedProjectIds } = get()
      // Always (re)fetch baseline for the current date range
      const baseline = await fetchAnalytics(dateRange)
      set({ baselineData: baseline, lastFetchedAt: Date.now() })

      if (selectedProjectIds.length > 0) {
        const filtered = await fetchAnalytics(dateRange, selectedProjectIds)
        set({ analyticsData: filtered })
      } else {
        set({ analyticsData: baseline })
      }
    } catch (err) {
      set({ error: String(err) })
    } finally {
      set({ isLoading: false })
    }
  },
}))
