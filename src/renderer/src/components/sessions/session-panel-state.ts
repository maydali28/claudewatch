// Pure view-selection logic for `session-panel.tsx`, extracted so it can be
// tested without a React renderer (this repo's vitest config runs with
// `environment: 'node'` — no jsdom, no React render tests).
//
// Priority, per the ruling that motivated this file: `empty` (no active
// session) beats `error` (a load failed and nothing is currently loading)
// beats `loading` (a fetch is in flight, or nothing has been parsed yet)
// beats `content`. `error` must be checked before `loading` so a failed load
// (isLoadingSession: false, sessionError set) doesn't fall into the
// `!hasParsedSession` loading branch and render an endless skeleton instead
// of the error — that was the bug this type was introduced to fix.
export type SessionPanelView = 'empty' | 'loading' | 'error' | 'content'

export function sessionPanelView(s: {
  activeSessionId: string | null
  isLoadingSession: boolean
  sessionError: string | null
  hasParsedSession: boolean
}): SessionPanelView {
  if (!s.activeSessionId) return 'empty'
  if (s.sessionError && !s.isLoadingSession) return 'error'
  if (s.isLoadingSession || !s.hasParsedSession) return 'loading'
  return 'content'
}
