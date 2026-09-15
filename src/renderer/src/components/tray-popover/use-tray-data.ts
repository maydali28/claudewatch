import { useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TraySnapshot, TraySnapshotSession } from '@shared/types/analytics'
import type { UpdateInfo } from '@shared/types/project'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import { buildWeeklyUsage } from './weekly-usage'

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
  // "today" and "yesterday" are real calendar days.
  const weeklyUsage = buildWeeklyUsage(
    (snapshot?.weekly ?? []).map((d) => ({
      date: d.date,
      inputTokens: d.tokens,
      outputTokens: 0,
      estimatedCost: d.cost,
    }))
  )

  const activeSessions = snapshot?.activeSessions ?? []
  const recentSessions = snapshot?.recentSessions ?? []

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
