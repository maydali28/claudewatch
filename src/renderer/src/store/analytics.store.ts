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

// Requests resolve out of order. Selecting 10 August and then 11 August left
// the 11 August filter displaying 10 August's data whenever that first
// request happened to be slower. `setProjectFilter` and `refresh` both
// publish into `analyticsData`/`isLoading`/`error`, so they share this one
// counter: only the most recently *started* request may ever publish into
// those fields, regardless of which one settles first.
//
// `baselineData` is NOT gated by this counter, even though `refresh` writes
// it under the same guard pattern — it is written ONLY by `refresh`, never by
// `setProjectFilter`. Gating it on the shared counter meant a
// `setProjectFilter` call starting while a `refresh` baseline fetch was still
// outstanding would bump this counter and permanently discard that baseline
// publish, even though the fetch succeeded and no other baseline fetch ever
// superseded it — worse than having no guard at all, since pre-fix the
// baseline always landed. `baselineGeneration` below is bumped only by
// `refresh`, so a baseline publish is discarded only when a newer `refresh`
// call's baseline fetch actually supersedes it.
let requestGeneration = 0
let baselineGeneration = 0

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
      // Going back to "all" — reuse baseline as main data if available. This
      // is synchronous (nothing in flight to race), so it does not touch
      // requestGeneration — an already in-flight fetch is still the newest
      // request and must still be allowed to publish when it settles.
      if (baselineData) {
        set({ analyticsData: baselineData })
        return
      }
    }
    const generation = ++requestGeneration
    set({ isLoading: true, error: null })
    fetchAnalytics(dateRange, ids.length > 0 ? ids : undefined)
      .then((data) => {
        if (generation !== requestGeneration) return
        set({ analyticsData: data })
      })
      .catch((err) => {
        if (generation !== requestGeneration) return
        set({ error: String(err) })
      })
      .finally(() => {
        // A superseded request must not clear isLoading while the newer
        // request it lost to is still in flight — only the current
        // generation's own settle may flip the flag off.
        if (generation !== requestGeneration) return
        set({ isLoading: false })
      })
  },

  invalidate() {
    set({ lastFetchedAt: null })
  },

  async refresh(force = false) {
    const { lastFetchedAt, analyticsData } = get()
    const isStale = !lastFetchedAt || Date.now() - lastFetchedAt > CACHE_TTL_MS
    if (!force && analyticsData && !isStale) return

    const generation = ++requestGeneration
    const baselineGen = ++baselineGeneration
    set({ isLoading: true, error: null })
    try {
      const { dateRange } = get()
      // Always (re)fetch baseline for the current date range
      const baseline = await fetchAnalytics(dateRange)
      // Gated on baselineGeneration, not the shared `generation` — this fetch
      // succeeded and is only stale if a NEWER refresh() superseded it, not
      // merely because a setProjectFilter() call happened to start meanwhile.
      if (baselineGen === baselineGeneration) {
        set({ baselineData: baseline, lastFetchedAt: Date.now() })
      }
      if (generation !== requestGeneration) return

      // Re-read rather than reuse a value captured before the await above:
      // setProjectFilter's "reuse baseline" branch changes selectedProjectIds
      // synchronously without bumping requestGeneration (see its comment), so
      // a stale local here could fetch — or skip fetching — the wrong filter
      // even though this request is still the current generation.
      const { selectedProjectIds } = get()
      if (selectedProjectIds.length > 0) {
        const filtered = await fetchAnalytics(dateRange, selectedProjectIds)
        if (generation !== requestGeneration) return
        set({ analyticsData: filtered })
      } else {
        set({ analyticsData: baseline })
      }
    } catch (err) {
      if (generation !== requestGeneration) return
      set({ error: String(err) })
    } finally {
      // no-unsafe-finally forbids `return` here, so branch instead — same
      // effect as the guard elsewhere in this function.
      if (generation === requestGeneration) set({ isLoading: false })
    }
  },
}))
