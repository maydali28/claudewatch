import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SESSION_MS,
  OPEN_TURN_ACTIVE_MS,
  TRAY_RECENT_SESSION_COUNT,
} from '@shared/constants/tuning'
import {
  isSessionLive,
  isSubagentRunning,
  partitionLiveSessions,
  type LiveSessionSignal,
} from './live-session'

const NOW = Date.parse('2026-09-16T10:00:00.000Z')
const agoIso = (ms: number): string => new Date(NOW - ms).toISOString()

describe('isSessionLive', () => {
  it('is live when written to within the short window, whatever the turn state', () => {
    expect(
      isSessionLive({ lastTimestamp: agoIso(ACTIVE_SESSION_MS - 1), turnOpen: true }, NOW)
    ).toBe(true)
    expect(
      isSessionLive({ lastTimestamp: agoIso(ACTIVE_SESSION_MS - 1), turnOpen: false }, NOW)
    ).toBe(true)
  })

  it('is not live once a closed turn falls outside the short window', () => {
    expect(isSessionLive({ lastTimestamp: agoIso(ACTIVE_SESSION_MS), turnOpen: false }, NOW)).toBe(
      false
    )
  })

  it('stays live through a long silent tool run while the turn is still open', () => {
    expect(isSessionLive({ lastTimestamp: agoIso(5 * 60_000), turnOpen: true }, NOW)).toBe(true)
  })

  it('gives up on an open turn after the open-turn cap, so an abandoned session does not stay live forever', () => {
    expect(isSessionLive({ lastTimestamp: agoIso(OPEN_TURN_ACTIVE_MS), turnOpen: true }, NOW)).toBe(
      false
    )
  })

  it('is never live on an unparsable timestamp', () => {
    expect(isSessionLive({ lastTimestamp: 'not a date', turnOpen: true }, NOW)).toBe(false)
    expect(isSessionLive({ lastTimestamp: '', turnOpen: true }, NOW)).toBe(false)
  })
})

describe('partitionLiveSessions', () => {
  const row = (
    id: string,
    ageMs: number,
    turnOpen = false
  ): LiveSessionSignal & { id: string } => ({
    id,
    lastTimestamp: agoIso(ageMs),
    turnOpen,
  })

  it('splits live from the rest, newest first, and caps the rest at the tray limit', () => {
    const sessions = [
      row('old', 3_600_000),
      row('live', 10_000),
      row('open', 5 * 60_000, true),
      ...Array.from({ length: TRAY_RECENT_SESSION_COUNT }, (_, i) => row(`r${i}`, 120_000 + i)),
    ]
    const { active, recent } = partitionLiveSessions(sessions, NOW)
    expect(active.map((s) => s.id)).toEqual(['live', 'open'])
    expect(recent).toHaveLength(TRAY_RECENT_SESSION_COUNT)
    expect(recent[0].id).toBe('r0')
    expect(recent.map((s) => s.id)).not.toContain('old')
  })
})

describe('isSubagentRunning', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z')
  const ago = (ms: number): string => new Date(now - ms).toISOString()

  it('runs while the parent has no result for it and it wrote recently', () => {
    expect(isSubagentRunning({ lastTimestamp: ago(5 * 60_000), toolUseId: 't' }, now)).toBe(true)
  })

  it('stops once the parent recorded its end after its last write', () => {
    expect(
      isSubagentRunning({ lastTimestamp: ago(10_000), stoppedAt: ago(5_000), toolUseId: 't' }, now)
    ).toBe(false)
  })

  it('runs again when it was resumed after stopping', () => {
    expect(
      isSubagentRunning(
        { lastTimestamp: ago(1_000), stoppedAt: ago(60_000), isBackground: true },
        now
      )
    ).toBe(true)
  })

  it('is abandoned past the open-turn cap', () => {
    expect(
      isSubagentRunning({ lastTimestamp: ago(OPEN_TURN_ACTIVE_MS + 1), toolUseId: 't' }, now)
    ).toBe(false)
  })

  it('falls back to short recency without a meta file', () => {
    expect(isSubagentRunning({ lastTimestamp: ago(ACTIVE_SESSION_MS - 1) }, now)).toBe(true)
    expect(isSubagentRunning({ lastTimestamp: ago(ACTIVE_SESSION_MS + 1) }, now)).toBe(false)
  })

  it('is never running with an unparsable timestamp', () => {
    expect(isSubagentRunning({ lastTimestamp: 'garbage', toolUseId: 't' }, now)).toBe(false)
  })
})
