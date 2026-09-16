import type { TraySnapshotSession } from '@shared/types/analytics'
import { partitionLiveSessions } from '@shared/utils/live-session'

export interface TraySessionLists {
  activeSessions: TraySnapshotSession[]
  recentSessions: TraySnapshotSession[]
}

/**
 * Re-judges main's active/recent split against the popover's own clock.
 *
 * Main decides "active" once, when it builds the snapshot. The popover then
 * holds that answer for as long as no newer snapshot arrives — and while the
 * panel is hidden its 30s poll is skipped, so a session that went quiet
 * minutes ago was still shown live the moment the tray opened. The dashboard
 * row already ages its own dot every 15s; this is the tray's equivalent, and
 * both go through the same `isSessionLive`.
 *
 * Only aging OUT is possible here: a session main called recent cannot become
 * active without a new write, and a new write always arrives as a push that
 * refetches the snapshot. Re-running main's own `partitionLiveSessions` over
 * both lists is what keeps the two surfaces on one rule.
 */
export function partitionTraySessions(
  active: TraySnapshotSession[],
  recent: TraySnapshotSession[],
  nowMs: number
): TraySessionLists {
  const result = partitionLiveSessions([...active, ...recent], nowMs)
  return { activeSessions: result.active, recentSessions: result.recent }
}
