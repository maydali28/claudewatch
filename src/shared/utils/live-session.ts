import {
  ACTIVE_SESSION_MS,
  OPEN_TURN_ACTIVE_MS,
  TRAY_RECENT_SESSION_COUNT,
} from '@shared/constants/tuning'
import { compareTimestampsAscending } from '@shared/utils/date-ranges'

/** The two fields liveness is judged on; both `SessionSummary` and `TraySnapshotSession` carry them. */
export interface LiveSessionSignal {
  lastTimestamp: string
  turnOpen: boolean
}

/**
 * The ONE definition of "live", shared by the tray snapshot (main), the tray
 * popover and the dashboard session list (renderer), so the three surfaces
 * cannot disagree on it.
 *
 * A session is live when it was written to within `ACTIVE_SESSION_MS`, or —
 * because Claude Code writes nothing while a tool runs or a long response
 * generates — when its turn is still open and it was written to within the
 * longer `OPEN_TURN_ACTIVE_MS`. An unparsable timestamp is never live: `NaN`
 * fails both comparisons.
 */
export function isSessionLive(session: LiveSessionSignal, nowMs: number): boolean {
  const ageMs = nowMs - new Date(session.lastTimestamp).getTime()
  if (ageMs < ACTIVE_SESSION_MS) return true
  return session.turnOpen && ageMs < OPEN_TURN_ACTIVE_MS
}

/**
 * The tray's active/recent split, in one place: live sessions in their given
 * order, then the newest `TRAY_RECENT_SESSION_COUNT` of the rest, newest
 * first. `buildTraySnapshot` applies it to the full scan in main; the popover
 * re-applies it to the snapshot it holds, so an aged-out session moves lists
 * by the same rule main would have used.
 *
 * Sorted via `compareTimestampsAscending` with the arguments swapped rather
 * than subtracting two `getTime()`s: an unparsable `lastTimestamp` would make
 * that `NaN` and break `Array.prototype.sort`'s contract.
 */
export function partitionLiveSessions<T extends LiveSessionSignal>(
  sessions: readonly T[],
  nowMs: number
): { active: T[]; recent: T[] } {
  const active: T[] = []
  const rest: T[] = []
  for (const s of sessions) (isSessionLive(s, nowMs) ? active : rest).push(s)
  const recent = rest
    .sort((a, b) => compareTimestampsAscending(b.lastTimestamp, a.lastTimestamp))
    .slice(0, TRAY_RECENT_SESSION_COUNT)
  return { active, recent }
}
