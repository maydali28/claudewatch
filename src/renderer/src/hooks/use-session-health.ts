import { useCallback, useEffect, useMemo } from 'react'
import { useSecretsStore } from '@renderer/store/secrets.store'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useUIStore } from '@renderer/store/ui.store'
import { evaluateSessionHealth, worstSeverity } from '@shared/utils/session-health'
import type { SessionHealthCheck } from '@shared/utils/session-health'
import type { LintSeverity, SecretFindingRecord, SessionSummary } from '@shared/types'

/** Secrets not yet dismissed, by session id. Loads the findings once. */
export function useSecretsBySession(): Map<string, SecretFindingRecord[]> {
  const findings = useSecretsStore((s) => s.findings)
  const isLoaded = useSecretsStore((s) => s.isLoaded)
  const load = useSecretsStore((s) => s.load)
  useEffect(() => {
    if (!isLoaded) void load()
  }, [isLoaded, load])
  return useMemo(() => {
    const map = new Map<string, SecretFindingRecord[]>()
    for (const f of findings) {
      if (f.dismissed) continue
      map.set(f.sessionId, [...(map.get(f.sessionId) ?? []), f])
    }
    return map
  }, [findings])
}

export interface SessionHealth {
  checks: SessionHealthCheck[]
  secrets: SecretFindingRecord[]
  /** Failing checks plus secrets. */
  count: number
  severity: LintSeverity | null
}

export function sessionHealth(
  session: SessionSummary,
  secrets: SecretFindingRecord[] = []
): SessionHealth {
  const checks = evaluateSessionHealth(session)
  return {
    checks,
    secrets,
    count: checks.length + secrets.length,
    severity: worstSeverity([...checks.map((c) => c.severity), ...secrets.map((s) => s.severity)]),
  }
}

/** Opens a session on its Health tab, from anywhere in the app. */
export function useOpenSessionHealth(): (sessionId: string, projectId: string) => void {
  const setView = useUIStore((s) => s.setView)
  const requestSessionTab = useUIStore((s) => s.requestSessionTab)
  const loadParsedSession = useSessionsStore((s) => s.loadParsedSession)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  return useCallback(
    (sessionId, projectId) => {
      requestSessionTab(sessionId, 'health')
      setView('sessions')
      if (sessionId !== activeSessionId) void loadParsedSession(sessionId, projectId)
    },
    [activeSessionId, loadParsedSession, requestSessionTab, setView]
  )
}
