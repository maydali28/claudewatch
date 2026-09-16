import { describe, expect, it } from 'vitest'
import type { TraySnapshotSession } from '@shared/types/analytics'
import { ACTIVE_SESSION_MS, TRAY_RECENT_SESSION_COUNT } from '@shared/constants/tuning'
import { partitionTraySessions } from './live-sessions'

const NOW = Date.parse('2026-09-16T10:00:00.000Z')
const agoIso = (ms: number): string => new Date(NOW - ms).toISOString()

function row(id: string, lastTimestamp: string, turnOpen = false): TraySnapshotSession {
  return {
    id,
    projectId: 'p',
    projectPath: '/p',
    title: id,
    messageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastTimestamp,
    hasError: false,
    turnOpen,
  }
}

describe('partitionTraySessions', () => {
  it('leaves a snapshot alone while everything main called active is still within the window', () => {
    const active = [row('a', agoIso(10_000))]
    const recent = [row('r', agoIso(3_600_000))]
    expect(partitionTraySessions(active, recent, NOW)).toEqual({
      activeSessions: active,
      recentSessions: recent,
    })
  })

  it('ages a session out of the active list once the snapshot main built has gone stale', () => {
    // Main marked it active at snapshot time; the popover was hidden and no
    // newer snapshot arrived. By now it has been silent longer than the window.
    const stale = row('a', agoIso(ACTIVE_SESSION_MS + 1_000))
    const recent = [row('r', agoIso(3_600_000))]
    const result = partitionTraySessions([stale], recent, NOW)
    expect(result.activeSessions).toEqual([])
    expect(result.recentSessions.map((s) => s.id)).toEqual(['a', 'r'])
  })

  it('keeps an open-turn session active past the short window', () => {
    const openTurn = row('a', agoIso(5 * 60_000), true)
    const result = partitionTraySessions([openTurn], [], NOW)
    expect(result.activeSessions).toEqual([openTurn])
  })

  it('caps the recent list at the tray limit after an aged-out session joins it', () => {
    const stale = row('a', agoIso(ACTIVE_SESSION_MS + 1_000))
    const recent = Array.from({ length: TRAY_RECENT_SESSION_COUNT }, (_, i) =>
      row(`r${i}`, agoIso(3_600_000 + i * 1_000))
    )
    const result = partitionTraySessions([stale], recent, NOW)
    expect(result.recentSessions).toHaveLength(TRAY_RECENT_SESSION_COUNT)
    expect(result.recentSessions[0].id).toBe('a')
  })
})
