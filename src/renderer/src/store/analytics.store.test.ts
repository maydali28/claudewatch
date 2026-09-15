import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalyticsData, DateRange } from '@shared/types'
import type { Result } from '@shared/ipc/contracts'

// The stores talk to the main process only through ipc-client. Mocking it here
// (rather than electron itself) matches how src/main/ipc/settings.handlers.test.ts
// isolates its handler from its collaborators.
const mockAnalyticsGet = vi.fn<(...args: unknown[]) => Promise<Result<AnalyticsData>>>()
vi.mock('@renderer/lib/ipc-client', () => ({
  ipc: {
    analytics: {
      get: (...args: unknown[]) => mockAnalyticsGet(...args),
    },
  },
}))

import { useAnalyticsStore } from './analytics.store'

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

// Flushes the microtask queue past a resolved promise's .then/.catch/.finally
// chain. A real setTimeout(0) round trip is used instead of a fixed number of
// `await Promise.resolve()` hops because the exact hop count through a
// three-link chain is an implementation detail, not a contract.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const RANGE_A: DateRange = { preset: 'custom', from: '2026-08-10', to: '2026-08-10' }
const RANGE_B: DateRange = { preset: 'custom', from: '2026-08-11', to: '2026-08-11' }
const DATA_A = { totalSessions: 10 } as unknown as AnalyticsData
const DATA_B = { totalSessions: 11 } as unknown as AnalyticsData

function ok(data: AnalyticsData): Result<AnalyticsData> {
  return { ok: true, data }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAnalyticsStore.setState({
    analyticsData: null,
    baselineData: null,
    lastFetchedAt: null,
    dateRange: '7d',
    selectedProjectIds: [],
    isLoading: false,
    error: null,
  })
})

describe('useAnalyticsStore — request-generation guard', () => {
  it('publishes normally for an ordinary single refresh', async () => {
    mockAnalyticsGet.mockResolvedValueOnce(ok(DATA_A))

    await useAnalyticsStore.getState().refresh(true)

    const state = useAnalyticsStore.getState()
    expect(state.analyticsData).toBe(DATA_A)
    expect(state.baselineData).toBe(DATA_A)
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('keeps the later selection when the earlier request resolves last (refresh)', async () => {
    const first = deferred<Result<AnalyticsData>>()
    const second = deferred<Result<AnalyticsData>>()
    mockAnalyticsGet.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    // Select 10 August, then 11 August — mirrors the reported defect exactly.
    useAnalyticsStore.setState({ dateRange: RANGE_A })
    const firstLoad = useAnalyticsStore.getState().refresh(true)
    useAnalyticsStore.setState({ dateRange: RANGE_B })
    const secondLoad = useAnalyticsStore.getState().refresh(true)

    // The second (11 August) request resolves first...
    second.resolve(ok(DATA_B))
    await secondLoad
    // ...then the first (10 August) request resolves last.
    first.resolve(ok(DATA_A))
    await firstLoad

    const state = useAnalyticsStore.getState()
    expect(state.analyticsData).toBe(DATA_B)
    expect(state.baselineData).toBe(DATA_B)
  })

  it('does not clear isLoading when a superseded request finishes before the newer one', async () => {
    const first = deferred<Result<AnalyticsData>>()
    const second = deferred<Result<AnalyticsData>>()
    mockAnalyticsGet.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const firstLoad = useAnalyticsStore.getState().refresh(true)
    const secondLoad = useAnalyticsStore.getState().refresh(true)

    first.resolve(ok(DATA_A))
    await firstLoad
    // The newer request is still in flight — the UI must still show "loading".
    expect(useAnalyticsStore.getState().isLoading).toBe(true)

    second.resolve(ok(DATA_B))
    await secondLoad
    expect(useAnalyticsStore.getState().isLoading).toBe(false)
    expect(useAnalyticsStore.getState().analyticsData).toBe(DATA_B)
  })

  it('ignores a superseded setProjectFilter response (the .then() chain publish point)', async () => {
    const first = deferred<Result<AnalyticsData>>()
    const second = deferred<Result<AnalyticsData>>()
    mockAnalyticsGet.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    useAnalyticsStore.getState().setProjectFilter(['p1'])
    useAnalyticsStore.getState().setProjectFilter(['p2'])

    second.resolve(ok(DATA_B))
    await flushAsync()
    first.resolve(ok(DATA_A))
    await flushAsync()

    const state = useAnalyticsStore.getState()
    expect(state.analyticsData).toBe(DATA_B)
    expect(state.isLoading).toBe(false)
  })

  // Round-1 review finding: a single requestGeneration shared by both loaders
  // starved baselineData, which only refresh() ever writes. A setProjectFilter
  // call starting while refresh()'s baseline fetch is outstanding bumped that
  // shared counter, so the baseline publish was discarded even though the
  // fetch succeeded and no other baseline fetch ever superseded it. This is a
  // realistic interleaving: use-file-events.ts calls refreshAnalytics() on
  // every push event, which can land while the user is mid-click on a filter.
  it('publishes baselineData from refresh() even when a concurrent setProjectFilter call bumps the shared counter', async () => {
    const baselineFetch = deferred<Result<AnalyticsData>>()
    const filterFetch = deferred<Result<AnalyticsData>>()
    mockAnalyticsGet
      .mockReturnValueOnce(baselineFetch.promise)
      .mockReturnValueOnce(filterFetch.promise)

    const refreshPromise = useAnalyticsStore.getState().refresh(true)
    // Starts its own fetch and bumps the shared requestGeneration — but must
    // not be able to discard refresh()'s still-outstanding baseline fetch.
    useAnalyticsStore.getState().setProjectFilter(['p1'])

    baselineFetch.resolve(ok(DATA_A))
    await refreshPromise

    expect(useAnalyticsStore.getState().baselineData).toBe(DATA_A)
    // The shared generation was superseded, so refresh()'s own analyticsData
    // publish for this baseline must still be skipped — setProjectFilter is
    // the current request for that field.
    expect(useAnalyticsStore.getState().analyticsData).toBeNull()

    filterFetch.resolve(ok(DATA_B))
    await flushAsync()
    expect(useAnalyticsStore.getState().analyticsData).toBe(DATA_B)
  })
})
