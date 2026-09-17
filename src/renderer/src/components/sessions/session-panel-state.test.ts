import { describe, it, expect } from 'vitest'
import { sessionPanelView, type SessionPanelView } from './session-panel-state'

describe('sessionPanelView', () => {
  it.each([
    [
      {
        activeSessionId: null,
        isLoadingSession: false,
        sessionError: null,
        hasParsedSession: false,
      },
      'empty',
    ],
    [
      { activeSessionId: 's', isLoadingSession: true, sessionError: null, hasParsedSession: false },
      'loading',
    ],
    // The bug this type exists to fix: rendered as loading today.
    [
      {
        activeSessionId: 's',
        isLoadingSession: false,
        sessionError: 'ENOENT',
        hasParsedSession: false,
      },
      'error',
    ],
    [
      { activeSessionId: 's', isLoadingSession: false, sessionError: null, hasParsedSession: true },
      'content',
    ],
    [
      {
        activeSessionId: 's',
        isLoadingSession: true,
        sessionError: 'stale',
        hasParsedSession: false,
      },
      'loading',
    ],
  ] as const)('%o → %s', (s, expected: SessionPanelView) => {
    expect(sessionPanelView(s)).toBe(expected)
  })
})
