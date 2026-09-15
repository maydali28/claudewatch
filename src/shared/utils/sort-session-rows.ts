import type { SessionPeriodRow } from '@shared/types/analytics'
import { compareTimestampsAscending } from './date-ranges'

export type SessionRowSortKey =
  'lastTimestamp' | 'parentMessageCount' | 'estimatedCost' | 'totalTokens'
export type SessionRowSortDir = 'asc' | 'desc'

/**
 * Sorts the Overview tab's session rows.
 *
 * The key is named `parentMessageCount`, not `messageCount`, because it sorts
 * by the field the table's "Messages (parent)" column renders — not the
 * combined parent+subagent count. A generic `messageCount` name invited a
 * session with heavy subagent chatter but few parent turns to land somewhere
 * the displayed number didn't predict; naming the key after the field it
 * reads keeps that agreement enforceable by inspection, not just by comment.
 * Kept as one shared function (rather than inline in the component) so the
 * rule the table displays by is the same rule it sorts by, and that agreement
 * is something a plain test can check without a DOM.
 */
export function sortSessionRows(
  rows: SessionPeriodRow[],
  key: SessionRowSortKey,
  dir: SessionRowSortDir
): SessionPeriodRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'lastTimestamp':
        return sign * compareTimestampsAscending(a.lastTimestamp, b.lastTimestamp)
      case 'parentMessageCount':
        return sign * (a.parentMessageCount - b.parentMessageCount)
      case 'estimatedCost':
        return sign * (a.estimatedCost - b.estimatedCost)
      case 'totalTokens':
        return (
          sign *
          (a.totalInputTokens + a.totalOutputTokens - (b.totalInputTokens + b.totalOutputTokens))
        )
      default:
        return 0
    }
  })
}
