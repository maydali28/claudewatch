import type { SecretFindingRecord } from '@shared/types/secrets'

/** What a system notification needs from Electron, injected so it can be tested. */
export interface SecretNotifierDeps {
  /** Whether the user wants system notifications for findings. */
  isEnabled: () => boolean
  /** True while the dashboard has focus: the in-app toast already says it. */
  isAppFocused: () => boolean
  titleOf: (projectId: string, sessionId: string) => string | undefined
  show: (note: { title: string; body: string; onClick: () => void }) => void
  openSession: (projectId: string, sessionId: string) => void
}

/**
 * One system notification per session for newly found live secrets, while
 * ClaudeWatch is not the focused app. It names the kind of secret and the
 * session but never the value, not even masked: a system notification can
 * show on a lock screen. Clicking it opens the session.
 */
export function notifySecretFindings(
  findings: readonly SecretFindingRecord[],
  deps: SecretNotifierDeps
): void {
  if (!deps.isEnabled() || deps.isAppFocused()) return
  const bySession = new Map<string, SecretFindingRecord[]>()
  for (const f of findings) {
    if (f.source !== 'live') continue
    const key = `${f.projectId}\u0000${f.sessionId}`
    bySession.set(key, [...(bySession.get(key) ?? []), f])
  }
  for (const group of bySession.values()) {
    const { projectId, sessionId } = group[0]
    const session = deps.titleOf(projectId, sessionId) ?? 'a session'
    const what =
      group.length === 1 ? `A possible ${group[0].patternName}` : `${group.length} possible secrets`
    deps.show({
      title: 'Secret in a Claude Code session',
      body: `${what} ${group.length === 1 ? 'was' : 'were'} written to “${session}”.`,
      onClick: () => deps.openSession(projectId, sessionId),
    })
  }
}
