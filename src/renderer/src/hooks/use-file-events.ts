import { useEffect } from 'react'
import type { SessionSummary } from '@shared/types'
import { CHANNELS } from '@shared/ipc/channels'
import { ipc } from '@renderer/lib/ipc-client'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useAnalyticsStore } from '@renderer/store/analytics.store'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'

/**
 * Subscribe to push events from the main process.
 * Call once in the app root component (app.tsx).
 */
export function useFileEvents(): void {
  const handleSessionUpdated = useSessionsStore((s) => s.handleSessionUpdated)
  const handleSessionCreated = useSessionsStore((s) => s.handleSessionCreated)
  const loadParsedSession = useSessionsStore((s) => s.loadParsedSession)
  const loadAllConfig = useConfigStore((s) => s.loadAll)
  const invalidateAnalytics = useAnalyticsStore((s) => s.invalidate)
  const refreshAnalytics = useAnalyticsStore((s) => s.refresh)
  const setView = useUIStore((s) => s.setView)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return

    const unsubUpdated = ipc.on<SessionSummary>(CHANNELS.PUSH_SESSION_UPDATED, (summary) => {
      handleSessionUpdated(summary)
      invalidateAnalytics()
      refreshAnalytics()
    })

    const unsubCreated = ipc.on<SessionSummary>(CHANNELS.PUSH_SESSION_CREATED, (summary) => {
      handleSessionCreated(summary)
      invalidateAnalytics()
      refreshAnalytics()
    })

    const unsubConfig = ipc.on(CHANNELS.PUSH_CONFIG_CHANGED, () => {
      loadAllConfig()
    })

    // Tray popover requested navigation to a specific session
    const unsubNavigate = ipc.on<{ sessionId: string; projectId: string }>(
      CHANNELS.PUSH_NAVIGATE_SESSION,
      ({ sessionId, projectId }) => {
        setView('sessions')
        loadParsedSession(sessionId, projectId)
      }
    )

    // Surface main-process crashes as a toast so users notice them. The full
    // stack is in the log file (electron-log writes to ~/Library/Logs).
    const unsubMainError = ipc.on<{ origin: string; message: string; stack?: string }>(
      CHANNELS.PUSH_MAIN_ERROR,
      ({ origin, message }) => {
        const toast = (window as unknown as { __toast?: (m: string, v: string) => void }).__toast
        toast?.(`Background error (${origin}): ${message}`, 'error')
      }
    )

    return () => {
      unsubUpdated()
      unsubCreated()
      unsubConfig()
      unsubNavigate()
      unsubMainError()
    }
  }, [
    handleSessionUpdated,
    handleSessionCreated,
    loadParsedSession,
    loadAllConfig,
    invalidateAnalytics,
    refreshAnalytics,
    setView,
  ])
}
