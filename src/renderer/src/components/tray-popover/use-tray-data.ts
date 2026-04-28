import { useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AnalyticsData, SessionSummary } from '@shared/types'
import type { UpdateInfo } from '@shared/types/project'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'

const ACTIVE_SESSION_MS = 60_000
const REFRESH_INTERVAL_MS = 30_000

// Query keys are grouped under 'tray' so the push-event handler can invalidate
// the analytics + sessions trio with a single prefix without touching
// orthogonal data (settings, update info).
const TRAY_ANALYTICS_KEY = ['tray', 'analytics'] as const
const TRAY_UPDATE_INFO_KEY = ['tray', 'updateInfo'] as const
const TRAY_SETTINGS_KEY = ['tray', 'settings'] as const

interface TrayAnalytics {
  today: AnalyticsData | null
  weekly: AnalyticsData | null
  sessions: SessionSummary[]
  partialError: string | null
}

async function fetchTrayAnalytics(): Promise<TrayAnalytics> {
  const [todayResult, weeklyResult, projectsResult] = await Promise.all([
    ipc.analytics.get({ dateRange: 'today' }),
    ipc.analytics.get({ dateRange: '7d' }),
    ipc.sessions.listProjects(),
  ])

  // The tray surfaces partial data when one of the three calls fails — we
  // want the UI to keep showing whatever resolved rather than blanking out,
  // so failures are stashed alongside the data instead of thrown.
  const partialError = !todayResult.ok ? todayResult.error : null

  return {
    today: todayResult.ok ? todayResult.data : null,
    weekly: weeklyResult.ok ? weeklyResult.data : null,
    sessions: projectsResult.ok ? projectsResult.data.projects.flatMap((p) => p.sessions) : [],
    partialError,
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
  activeSessions: SessionSummary[]
  recentSessions: SessionSummary[]
  isLoading: boolean
  error: string | null
  updateInfo: UpdateInfo | null
  launchAtLogin: boolean
  trayTipDismissed: boolean
  setLaunchAtLogin: (val: boolean) => Promise<void>
  dismissTrayTip: () => Promise<void>
}

function flattenSessions(allSessions: SessionSummary[]): {
  activeSessions: SessionSummary[]
  recentSessions: SessionSummary[]
} {
  const now = Date.now()
  const sorted = [...allSessions].sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  )

  const activeSessions = sorted.filter(
    (s) => now - new Date(s.lastTimestamp).getTime() < ACTIVE_SESSION_MS
  )

  const inactiveSorted = sorted.filter(
    (s) => now - new Date(s.lastTimestamp).getTime() >= ACTIVE_SESSION_MS
  )
  const recentSessions = inactiveSorted.slice(0, 3)

  return { activeSessions, recentSessions }
}

export function useTrayData(): TrayData {
  const queryClient = useQueryClient()

  const analyticsQuery = useQuery({
    queryKey: TRAY_ANALYTICS_KEY,
    queryFn: fetchTrayAnalytics,
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
    const unsubUpdate = ipc.on<UpdateInfo>(CHANNELS.PUSH_UPDATE_AVAILABLE, (info) => {
      queryClient.setQueryData(TRAY_UPDATE_INFO_KEY, info)
    })
    return () => {
      unsubUpdated()
      unsubCreated()
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

  const analytics = analyticsQuery.data
  const todayAnalytics = analytics?.today ?? null
  const weeklyAnalytics = analytics?.weekly ?? null
  const allSessions = analytics?.sessions ?? []

  // todayAnalytics is scoped to 'today'; weeklyAnalytics provides 7-day sparkline data.
  const todayStats = {
    sessionCount: todayAnalytics?.totalSessions ?? 0,
    tokenCount: todayAnalytics?.totalTokens ?? 0,
    messageCount: todayAnalytics?.totalMessages ?? 0,
    cost: todayAnalytics?.totalCost ?? 0,
    projectCount: todayAnalytics?.projectCosts.length ?? 0,
  }

  // Use input + output only — matches the dashboard's per-project totalTokens
  // and the tray hero "Tokens today" (cache reads are excluded).
  const weeklyUsage = (weeklyAnalytics?.dailyUsage ?? []).slice(-7).map((d) => ({
    date: d.date,
    cost: d.estimatedCost,
    tokens: d.inputTokens + d.outputTokens,
  }))

  const { activeSessions, recentSessions } = flattenSessions(allSessions)

  const error = analyticsQuery.error
    ? String(analyticsQuery.error.message ?? analyticsQuery.error)
    : (analytics?.partialError ?? null)

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
