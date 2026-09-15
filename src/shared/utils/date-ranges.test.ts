import { describe, expect, it } from 'vitest'
import {
  compareTimestampsAscending,
  parseInstant,
  toDayKeyOrUndated,
  UNDATED_DAY,
} from './date-ranges'

describe('parseInstant', () => {
  it('parses a valid ISO timestamp to its millisecond instant', () => {
    expect(parseInstant('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  it('returns null, not NaN, for an unparseable timestamp', () => {
    expect(parseInstant('not-a-timestamp')).toBeNull()
    expect(parseInstant('')).toBeNull()
  })
})

/**
 * `compareTimestampsAscending('garbage', 'not-a-timestamp')` used to return
 * `NaN`: both unparseable inputs mapped to `-Infinity`, and
 * `-Infinity - -Infinity` is `NaN` in IEEE-754, not `0`. A comparator that
 * can return `NaN` breaks `Array.prototype.sort`'s contract — whether that
 * visibly scrambles a given array is V8-implementation behavior, not
 * something the spec guarantees, which is exactly why fixture-based sort
 * tests didn't catch it. These check the comparator's actual contract
 * (antisymmetry, transitivity, never `NaN`) over every pair/triple of a
 * mixed set, rather than only a few hand-picked orderings.
 */
describe('toDayKeyOrUndated', () => {
  it('returns the local day key for a parsable timestamp', () => {
    expect(toDayKeyOrUndated('2026-09-15T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it.each(['invalid', '', '   ', 'not-a-date', '2026-13-45T99:99:99Z'])(
    'returns UNDATED_DAY for %p rather than a NaN key',
    (ts) => {
      expect(toDayKeyOrUndated(ts)).toBe(UNDATED_DAY)
    }
  )
  it('returns UNDATED_DAY for a missing timestamp', () => {
    expect(toDayKeyOrUndated(undefined)).toBe(UNDATED_DAY)
    expect(toDayKeyOrUndated(null)).toBe(UNDATED_DAY)
  })
  it('never returns a key containing NaN', () => {
    expect(toDayKeyOrUndated('invalid')).not.toContain('NaN')
  })
})

describe('compareTimestampsAscending — comparator contract', () => {
  const values = [
    '2026-09-10T09:00:00.000Z',
    '2026-09-10T09:00:00.000Z', // exact duplicate of the above
    '2026-09-13T23:00:00Z',
    // Names 2026-09-13T22:30:00Z — earlier than the 'Z' value above — but
    // sorts after it as raw text.
    '2026-09-14T00:30:00+02:00',
    '2026-01-01T00:00:00-05:00',
    'garbage',
    'not-a-timestamp', // a second, distinct unparseable string
    '',
  ]

  it('reproduces the reported case directly: two distinct unparseable inputs compare equal, not NaN', () => {
    expect(compareTimestampsAscending('garbage', 'not-a-timestamp')).toBe(0)
  })

  it('never returns NaN for any pair in a mixed set', () => {
    for (const a of values) {
      for (const b of values) {
        expect(Number.isNaN(compareTimestampsAscending(a, b))).toBe(false)
      }
    }
  })

  it('is antisymmetric: compare(a, b) === -compare(b, a)', () => {
    // Plain `===`, not `.toBe` (which uses `Object.is`): negating a genuine
    // `0` result yields `-0` in JS, and `Object.is(0, -0)` is `false` even
    // though they're the same comparator outcome (tie).
    for (const a of values) {
      for (const b of values) {
        const same = compareTimestampsAscending(a, b) === -compareTimestampsAscending(b, a)
        expect(same).toBe(true)
      }
    }
  })

  it('is transitive over every triple', () => {
    for (const a of values) {
      for (const b of values) {
        for (const c of values) {
          if (compareTimestampsAscending(a, b) <= 0 && compareTimestampsAscending(b, c) <= 0) {
            expect(compareTimestampsAscending(a, c)).toBeLessThanOrEqual(0)
          }
        }
      }
    }
  })

  it('every comparison result is one of -1, 0, 1', () => {
    for (const a of values) {
      for (const b of values) {
        expect([-1, 0, 1]).toContain(compareTimestampsAscending(a, b))
      }
    }
  })
})
