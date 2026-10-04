import { useEffect } from 'react'
import type { SessionSummary } from '@shared/types'
import { CHANNELS } from '@shared/ipc/channels'
import { ipc } from '@renderer/lib/ipc-client'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useAnalyticsStore } from '@renderer/store/analytics.store'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { useSettingsStore } from '@renderer/store/settings.store'
import { useSecretsStore } from '@renderer/store/secrets.store'
import { toast } from '@renderer/components/shared/toast-host'
import type { SecretFindingRecord } from '@shared/types'

/**
 * Subscribe to push events from the main process.
 * Call once in the app root component (app.tsx).
 */
export function useFileEvents(): void {
  const handleSessionUpdated = useSessionsStore((s) => s.handleSessionUpdated)
  const handleSessionCreated = useSessionsStore((s) => s.handleSessionCreated)
  const handleSessionDeleted = useSessionsStore((s) => s.handleSessionDeleted)
  const handlePricingChanged = useSessionsStore((s) => s.handlePricingChanged)
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

    const unsubDeleted = ipc.on<{ sessionId: string; projectId: string }>(
      CHANNELS.PUSH_SESSION_DELETED,
      (payload) => {
        handleSessionDeleted(payload)
        invalidateAnalytics()
        refreshAnalytics()
      }
    )

    // Rates changed and main has repriced its caches: everything fetched
    // before shows costs at the old rates.
    const unsubPricing = ipc.on(CHANNELS.PUSH_PRICING_CHANGED, () => {
      void handlePricingChanged()
      invalidateAnalytics()
      refreshAnalytics()
    })

    // Secrets found as they were written: add them to the list and say so,
    // one toast per session, with a way to open it.
    const unsubSecrets = ipc.on<SecretFindingRecord[]>(CHANNELS.PUSH_SECRETS_FOUND, (found) => {
      useSecretsStore.getState().addFound(found)
      const live = found.filter((f) => f.source === 'live')
      const bySession = new Map<string, SecretFindingRecord[]>()
      for (const f of live) {
        const key = `${f.projectId}/${f.sessionId}`
        bySession.set(key, [...(bySession.get(key) ?? []), f])
      }
      for (const group of bySession.values()) {
        const { projectId, sessionId } = group[0]
        const title =
          useSessionsStore
            .getState()
            .projects.flatMap((p) => p.sessions)
            .find((s) => s.id === sessionId)?.title ?? sessionId.slice(0, 8)
        const what =
          group.length === 1
            ? `Possible ${group[0].patternName}`
            : `${group.length} possible secrets`
        toast(`${what} in “${title}”`, 'warning', 15_000, {
          label: 'Open session',
          onClick: () => {
            setView('sessions')
            loadParsedSession(sessionId, projectId)
          },
        })
      }
    })

    // Redaction is applied in main on the way out; a new setting needs a refetch.
    const unsubRedaction = useSettingsStore.subscribe((state, prev) => {
      if (state.prefs.redactionLevel !== prev.prefs.redactionLevel) {
        useSessionsStore.getState().handleRedactionChanged()
      }
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
      unsubSecrets()
      unsubRedaction()
      unsubUpdated()
      unsubCreated()
      unsubDeleted()
      unsubPricing()
      unsubConfig()
      unsubNavigate()
      unsubMainError()
    }
  }, [
    handleSessionUpdated,
    handleSessionCreated,
    handleSessionDeleted,
    handlePricingChanged,
    loadParsedSession,
    loadAllConfig,
    invalidateAnalytics,
    refreshAnalytics,
    setView,
  ])
}
