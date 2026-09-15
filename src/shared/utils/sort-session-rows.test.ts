import { describe, expect, it } from 'vitest'
import type { SessionPeriodRow } from '@shared/types/analytics'
import { sortSessionRows } from './sort-session-rows'

function row(over: Partial<SessionPeriodRow> & { id: string }): SessionPeriodRow {
  return {
    sessionId: over.id,
    projectId: 'proj',
    title: over.id,
    hasError: false,
    lastTimestamp: '2026-09-09T00:00:00.000Z',
    parentMessageCount: 0,
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCost: 0,
    ...over,
  }
}

/**
 * The table used to sort by `messageCount` (parent + subagent combined) while
 * rendering `parentMessageCount` — a session with many subagent chatter but
 * few parent turns could land anywhere in the list relative to what its own
 * displayed number would predict. The sort key is named `parentMessageCount`
 * (not `messageCount`) precisely so the field it reads can't drift from the
 * field the "Messages (parent)" column renders.
 */
describe('sortSessionRows — messages sorts by the value displayed', () => {
  it('orders by parentMessageCount, not the combined messageCount', () => {
    const rows: SessionPeriodRow[] = [
      // Fewer parent messages, but more combined (heavy subagent use) — a
      // combined-count sort would put this session ahead of 'b'.
      row({ id: 'a', parentMessageCount: 2, messageCount: 50 }),
      row({ id: 'b', parentMessageCount: 10, messageCount: 11 }),
    ]

    const asc = sortSessionRows(rows, 'parentMessageCount', 'asc').map((r) => r.id)
    expect(asc).toEqual(['a', 'b'])

    const desc = sortSessionRows(rows, 'parentMessageCount', 'desc').map((r) => r.id)
    expect(desc).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const rows: SessionPeriodRow[] = [
      row({ id: 'a', parentMessageCount: 1 }),
      row({ id: 'b', parentMessageCount: 2 }),
    ]
    sortSessionRows(rows, 'parentMessageCount', 'desc')
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('sortSessionRows — other keys', () => {
  it('sorts by estimatedCost', () => {
    const rows: SessionPeriodRow[] = [
      row({ id: 'a', estimatedCost: 5 }),
      row({ id: 'b', estimatedCost: 1 }),
    ]
    expect(sortSessionRows(rows, 'estimatedCost', 'asc').map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('sorts by combined tokens', () => {
    const rows: SessionPeriodRow[] = [
      row({ id: 'a', totalInputTokens: 10, totalOutputTokens: 0 }),
      row({ id: 'b', totalInputTokens: 1, totalOutputTokens: 1 }),
    ]
    expect(sortSessionRows(rows, 'totalTokens', 'desc').map((r) => r.id)).toEqual(['a', 'b'])
  })
})

/**
 * `lastTimestamp` is raw transcript text, not guaranteed to be `Z`-suffixed.
 * Comparing it with `localeCompare` sorted an offset-carrying timestamp by
 * its digits, not by the instant it names — the same defect fixed in the
 * accounting projection's "latest model" badge (see projection.ts). These
 * pin the fix from the table's side.
 */
describe('sortSessionRows — lastTimestamp compares instants, not text', () => {
  it('all-Z corpus orders correctly (regression pin)', () => {
    const rows: SessionPeriodRow[] = [
      row({ id: 'a', lastTimestamp: '2026-09-09T00:00:00.000Z' }),
      row({ id: 'b', lastTimestamp: '2026-09-08T00:00:00.000Z' }),
    ]
    expect(sortSessionRows(rows, 'lastTimestamp', 'asc').map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('orders correctly when timestamps carry mixed offsets', () => {
    const rows: SessionPeriodRow[] = [
      // '+02:00' names the instant 2026-09-13T22:30:00Z — earlier than 'b'
      // below — but as raw text it sorts AFTER 'b' because '14' > '13' in
      // the date portion. That's exactly what a lexical comparison gets
      // backwards.
      row({ id: 'a', lastTimestamp: '2026-09-14T00:30:00+02:00' }),
      row({ id: 'b', lastTimestamp: '2026-09-13T23:00:00Z' }),
    ]

    expect(sortSessionRows(rows, 'lastTimestamp', 'asc').map((r) => r.id)).toEqual(['a', 'b'])
    expect(sortSessionRows(rows, 'lastTimestamp', 'desc').map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('sorts an unparseable timestamp as the oldest possible, in both directions', () => {
    // Rule: an unparseable timestamp is never evidence that a session is
    // more recent than one with a real timestamp, so it always compares as
    // the oldest possible instant — first ascending, last descending —
    // rather than landing wherever NaN's comparison semantics happen to put
    // it.
    const rows: SessionPeriodRow[] = [
      row({ id: 'a', lastTimestamp: '2026-09-09T00:00:00.000Z' }),
      row({ id: 'garbage', lastTimestamp: 'not-a-timestamp' }),
      row({ id: 'b', lastTimestamp: '2026-09-08T00:00:00.000Z' }),
    ]

    expect(sortSessionRows(rows, 'lastTimestamp', 'asc').map((r) => r.id)).toEqual([
      'garbage',
      'b',
      'a',
    ])
    expect(sortSessionRows(rows, 'lastTimestamp', 'desc').map((r) => r.id)).toEqual([
      'a',
      'b',
      'garbage',
    ])
  })

  it('keeps multiple unparseable timestamps in their original relative order', () => {
    // Every unparseable timestamp maps to the same "oldest possible" instant,
    // so two of them compare equal — a stable sort (which Array.prototype.sort
    // guarantees) must leave their relative order untouched rather than the
    // comparator having to break the tie itself.
    const rows: SessionPeriodRow[] = [
      row({ id: 'g1', lastTimestamp: 'nope' }),
      row({ id: 'real', lastTimestamp: '2026-09-09T00:00:00.000Z' }),
      row({ id: 'g2', lastTimestamp: 'also-nope' }),
    ]

    expect(sortSessionRows(rows, 'lastTimestamp', 'asc').map((r) => r.id)).toEqual([
      'g1',
      'g2',
      'real',
    ])
  })
})
