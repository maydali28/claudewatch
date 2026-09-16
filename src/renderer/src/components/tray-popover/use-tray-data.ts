import { useEffect, useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TraySnapshot, TraySnapshotSession } from '@shared/types/analytics'
import type { UpdateInfo } from '@shared/types/project'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import { buildWeeklyUsage } from './weekly-usage'
import { partitionTraySessions } from './live-sessions'
import { LIVE_REFRESH_INTERVAL_MS } from '@shared/constants/tuning'

const REFRESH_INTERVAL_MS = 30_000

// Query keys are grouped under 'tray' so the push-event handler can invalidate
// the analytics + sessions trio with a single prefix without touching
// orthogonal data (settings, update info).
const TRAY_ANALYTICS_KEY = ['tray', 'analytics'] as const
const TRAY_UPDATE_INFO_KEY = ['tray', 'updateInfo'] as const
const TRAY_SETTINGS_KEY = ['tray', 'settings'] as const

async function fetchTraySnapshot(): Promise<{
  snapshot: TraySnapshot | null
  error: string | null
}> {
  // One call, reading the shared scan. This was three calls, one of which
  // forced a full discovery walk of every transcript on every 30s refresh.
  const result = await ipc.tray.getSnapshot()
  return {
    snapshot: result.ok ? result.data : null,
    error: result.ok ? null : result.error,
  }
}

async function fetchUpdateInfo(): Promise<UpdateInfo | null> {
  const result = await ipc.updates.check()
  return result.ok ? (result.data ?? null) : null
}

async function fetchSettings(): Promise<{ launchAtLogin: boolean; trayTipDismissed: boolean }> {
  const result = await ipc.settings.get()
  if (!result.ok) return { launchAtLogin: false, trayTipDismissed: false }
  return {
    launchAtLogin: result.data.launchAtLogin,
    trayTipDismissed: result.data.trayTipDismissed,
  }
}

export interface TrayData {
  todayStats: {
    sessionCount: number
    tokenCount: number
    messageCount: number
    cost: number
    projectCount: number
  }
  weeklyUsage: Array<{ date: string; cost: number; tokens: number }>
  activeSessions: TraySnapshotSession[]
  recentSessions: TraySnapshotSession[]
  isLoading: boolean
  error: string | null
  updateInfo: UpdateInfo | null
  launchAtLogin: boolean
  trayTipDismissed: boolean
  setLaunchAtLogin: (val: boolean) => Promise<void>
  dismissTrayTip: () => Promise<void>
}

export function useTrayData(): TrayData {
  const queryClient = useQueryClient()

  const analyticsQuery = useQuery({
    queryKey: TRAY_ANALYTICS_KEY,
    queryFn: fetchTraySnapshot,
    refetchInterval: REFRESH_INTERVAL_MS,
    // The popover is a persistent hidden panel. React Query skips the interval
    // while the page is hidden, and the shared client turns focus refetches
    // off — so opening the tray used to render whatever snapshot the last
    // push or poll left, for up to 30s. Refetch on every show instead
    // (`visibilitychange` is what drives focusManager), and treat the cached
    // snapshot as stale so that refetch actually happens.
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  const updateInfoQuery = useQuery({
    queryKey: TRAY_UPDATE_INFO_KEY,
    queryFn: fetchUpdateInfo,
  })
  const settingsQuery = useQuery({
    queryKey: TRAY_SETTINGS_KEY,
    queryFn: fetchSettings,
    placeholderData: { launchAtLogin: false, trayTipDismissed: false },
  })

  // Push events from the main process invalidate the relevant query so the
  // next render picks up fresh data — replaces the previous manual fetch
  // calls and the now-defunct unsubscribe gymnastics.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return
    const invalidateAnalytics = (): void => {
      queryClient.invalidateQueries({ queryKey: TRAY_ANALYTICS_KEY })
    }
    const unsubUpdated = ipc.on(CHANNELS.PUSH_SESSION_UPDATED, invalidateAnalytics)
    const unsubCreated = ipc.on(CHANNELS.PUSH_SESSION_CREATED, invalidateAnalytics)
    const unsubDeleted = ipc.on(CHANNELS.PUSH_SESSION_DELETED, invalidateAnalytics)
    const unsubUpdate = ipc.on<UpdateInfo>(CHANNELS.PUSH_UPDATE_AVAILABLE, (info) => {
      queryClient.setQueryData(TRAY_UPDATE_INFO_KEY, info)
    })
    return () => {
      unsubUpdated()
      unsubCreated()
      unsubDeleted()
      unsubUpdate()
    }
  }, [queryClient])

  const settingsMutation = useMutation({
    mutationFn: (patch: { launchAtLogin?: boolean; trayTipDismissed?: boolean }) =>
      ipc.settings.set(patch),
    // Optimistic update: write through the React Query cache immediately so
    // the UI reflects the user's choice without waiting for the IPC round
    // trip. On error we restore the previous snapshot.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: TRAY_SETTINGS_KEY })
      const previous = queryClient.getQueryData<{
        launchAtLogin: boolean
        trayTipDismissed: boolean
      }>(TRAY_SETTINGS_KEY)
      queryClient.setQueryData(TRAY_SETTINGS_KEY, {
        launchAtLogin: previous?.launchAtLogin ?? false,
        trayTipDismissed: previous?.trayTipDismissed ?? false,
        ...patch,
      })
      return { previous }
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(TRAY_SETTINGS_KEY, context.previous)
    },
  })

  const setLaunchAtLogin = useCallback(
    async (val: boolean) => {
      await settingsMutation.mutateAsync({ launchAtLogin: val })
    },
    [settingsMutation]
  )

  const dismissTrayTip = useCallback(async () => {
    await settingsMutation.mutateAsync({ trayTipDismissed: true })
  }, [settingsMutation])

  const snapshot = analyticsQuery.data?.snapshot ?? null

  const todayStats = {
    sessionCount: snapshot?.today.sessionCount ?? 0,
    tokenCount: snapshot?.today.tokenCount ?? 0,
    messageCount: snapshot?.today.messageCount ?? 0,
    cost: snapshot?.today.cost ?? 0,
    projectCount: snapshot?.today.projectCount ?? 0,
  }

  // Main sends only the days that had activity; the week is filled here so
  // "today" and "yesterday" are real calendar days. Memoised on the snapshot's
  // own series so the liveness clock below does not rebuild it every tick.
  const weekly = snapshot?.weekly
  const weeklyUsage = useMemo(
    () =>
      buildWeeklyUsage(
        (weekly ?? []).map((d) => ({
          date: d.date,
          inputTokens: d.tokens,
          outputTokens: 0,
          estimatedCost: d.cost,
        }))
      ),
    [weekly]
  )

  // Age main's active list against the popover's own clock (see
  // `partitionTraySessions`). The clock ticks only while there is something
  // to age out and the panel is actually visible — the popover is hidden
  // nearly all the time, and re-rendering a never-shown tree every 15s would
  // be waste; the refetch on show (above) supplies a fresh snapshot the
  // moment it matters. The clock never lags behind the snapshot it judges.
  const [now, setNow] = useState(() => Date.now())
  const clock = Math.max(now, analyticsQuery.dataUpdatedAt)

  const { activeSessions, recentSessions } = partitionTraySessions(
    snapshot?.activeSessions ?? [],
    snapshot?.recentSessions ?? [],
    clock
  )

  // Gated on the list AFTER partitioning, so the timer stops once everything
  // has aged out rather than running until the next snapshot happens along.
  const activeCount = activeSessions.length
  useEffect(() => {
    if (activeCount === 0) return
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, LIVE_REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [activeCount])

  const error = analyticsQuery.error
    ? String(analyticsQuery.error.message ?? analyticsQuery.error)
    : (analyticsQuery.data?.error ?? null)

  return {
    todayStats,
    weeklyUsage,
    activeSessions,
    recentSessions,
    isLoading: analyticsQuery.isLoading,
    error,
    updateInfo: updateInfoQuery.data ?? null,
    launchAtLogin: settingsQuery.data?.launchAtLogin ?? false,
    trayTipDismissed: settingsQuery.data?.trayTipDismissed ?? false,
    setLaunchAtLogin,
    dismissTrayTip,
  }
}
