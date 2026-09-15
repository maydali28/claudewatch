import { describe, expect, it } from 'vitest'
import { isSecretScanEligible, selectSessionsToScan, SEC_MIN_MESSAGES } from './sec.rules'
import type { SessionSummary } from '@shared/types/session'

const NOW = new Date('2026-09-13T12:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

function at(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString()
}

/**
 * The predicate previously summed `userMessageCount` and `assistantMessageCount`,
 * neither of which exists on SessionSummary. Both were undefined, the count was
 * always 0, and no session ever qualified — the secret scanner silently examined
 * nothing.
 */
describe('isSecretScanEligible', () => {
  it('still treats a five-message session as substantial after the count correction', () => {
    expect(isSecretScanEligible({ lastTimestamp: at(1), messageCount: 5 }, NOW)).toBe(true)
  })

  it('accepts a recent session with enough messages', () => {
    expect(
      isSecretScanEligible({ lastTimestamp: at(1), messageCount: SEC_MIN_MESSAGES }, NOW)
    ).toBe(true)
  })

  it('accepts a session well above the message threshold', () => {
    expect(isSecretScanEligible({ lastTimestamp: at(2), messageCount: 500 }, NOW)).toBe(true)
  })

  it('rejects a recent session below the message threshold', () => {
    expect(
      isSecretScanEligible({ lastTimestamp: at(1), messageCount: SEC_MIN_MESSAGES - 1 }, NOW)
    ).toBe(false)
  })

  it('rejects a busy session older than the lookback window', () => {
    expect(isSecretScanEligible({ lastTimestamp: at(31), messageCount: 500 }, NOW)).toBe(false)
  })

  it('accepts a busy session at the edge of the lookback window', () => {
    expect(isSecretScanEligible({ lastTimestamp: at(29), messageCount: 500 }, NOW)).toBe(true)
  })

  it('rejects a session with an unparseable timestamp', () => {
    expect(isSecretScanEligible({ lastTimestamp: '', messageCount: 500 }, NOW)).toBe(false)
  })
})

function session(id: string, daysAgo: number): SessionSummary {
  return { id, lastTimestamp: at(daysAgo), messageCount: 50 } as SessionSummary
}

/**
 * Now that the eligibility filter works, this rule reads the head of every
 * eligible transcript on a path that previously did no I/O at all. The scan is
 * bounded to the most recent sessions so a large history cannot make linting
 * unbounded, and ordered by recency so the bound keeps the most relevant ones.
 */
describe('selectSessionsToScan', () => {
  it('returns eligible sessions newest first', () => {
    const picked = selectSessionsToScan(
      [session('old', 10), session('new', 1), session('mid', 5)],
      NOW
    )
    expect(picked.map((s) => s.id)).toEqual(['new', 'mid', 'old'])
  })

  it('excludes ineligible sessions', () => {
    const stale = { ...session('stale', 90) } as SessionSummary
    const quiet = { ...session('quiet', 1), messageCount: 1 } as SessionSummary
    const picked = selectSessionsToScan([stale, quiet, session('good', 2)], NOW)
    expect(picked.map((s) => s.id)).toEqual(['good'])
  })

  it('caps the number of sessions scanned', () => {
    const many = Array.from({ length: 500 }, (_, i) => session(`s${i}`, 1))
    expect(selectSessionsToScan(many, NOW).length).toBeLessThanOrEqual(200)
  })

  /**
   * `selectSessionsToScan`'s sort now compares via `compareTimestampsAscending`
   * rather than a raw `getTime()` subtraction, matching every other
   * timestamp-sort call site fixed on this branch — but through this
   * function's own public API, a malformed (non-empty) `lastTimestamp` can
   * never actually reach that sort: `isSecretScanEligible`'s
   * `Number.isNaN(new Date(session.lastTimestamp).getTime())` guard (see
   * above) rejects it first, the same way it already rejects an empty
   * string. This pins that guarantee — a session with a non-empty but
   * unparsable timestamp, otherwise perfectly eligible, must never appear in
   * the scanned output at all — rather than testing the sort's NaN-handling
   * directly, which this call site cannot expose no matter how the fix is
   * written. (The `compareTimestampsAscending` swap itself is exercised
   * directly by `shared/utils/date-ranges.test.ts` and by every other fixed
   * call site's own tests.)
   */
  it('excludes a session with a non-empty unparsable timestamp before the sort ever sees it', () => {
    const garbage = { ...session('garbage', 1), lastTimestamp: 'not-a-timestamp' }
    const picked = selectSessionsToScan([garbage, session('good', 2)], NOW)
    expect(picked.map((s) => s.id)).toEqual(['good'])
  })
})
