import { describe, expect, it } from 'vitest'
import { judgeResponse, laterTimestamp, type PendingResponse } from './response-observability'

/**
 * `laterTimestamp` had no covering test at all — see
 * `docs/ACCOUNTING-BRANCH-FOLLOWUPS-2026-09-14.md`'s "no covering test"
 * bullet, which noted that mutating it to a bare assignment still passed the
 * suite. Its real defect: `new Date(b).getTime() > new Date(a).getTime()`
 * compares with `>`, and any comparison against `NaN` is `false` — so
 * whenever `a` was the unparsable one, the condition was always false and
 * the function returned `a`, the INVALID timestamp, discarding a perfectly
 * good `b`. These pin the fix: a parseable timestamp must win over an
 * unparsable one no matter which argument position it's in.
 */
describe('laterTimestamp', () => {
  it('returns the later of two valid timestamps', () => {
    expect(laterTimestamp('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(
      '2026-01-02T00:00:00.000Z'
    )
    expect(laterTimestamp('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(
      '2026-01-02T00:00:00.000Z'
    )
  })

  it('falls back to whichever side is present when the other is absent', () => {
    expect(laterTimestamp(undefined, '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
    expect(laterTimestamp('2026-01-01T00:00:00.000Z', undefined)).toBe('2026-01-01T00:00:00.000Z')
    expect(laterTimestamp(undefined, undefined)).toBeUndefined()
  })

  it('prefers a valid timestamp over an unparsable one when `a` is the invalid side', () => {
    // Pre-fix: `new Date(b).getTime() > new Date('garbage').getTime()` is
    // `someNumber > NaN`, which is always `false` — so this returned
    // 'garbage' instead of the perfectly good `b`.
    expect(laterTimestamp('garbage', '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('prefers a valid timestamp over an unparsable one when `b` is the invalid side', () => {
    expect(laterTimestamp('2026-01-01T00:00:00.000Z', 'garbage')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('is deterministic (not NaN-dependent) when both sides are unparsable', () => {
    expect(laterTimestamp('garbage', 'also-garbage')).toBe('also-garbage')
  })
})

/**
 * The invariant `computeLatencyAnalytics` relies on, pinned where it is
 * actually established.
 *
 * That function used to carry ~24 lines of comment describing how it handles
 * a `TurnDuration` whose `assistantTimestamp` is present but unparsable, and
 * a controller-accepted ruling about excluding such turns from `all`. The
 * state cannot occur: `judgeResponse` is the only producer of a
 * `TurnDuration`, and `durationMs` is `NaN` — never `> 0` — whenever either
 * timestamp fails to parse. Reverting that function's `toDayKeyOrUndated` to
 * a plain `toDateKey` left the whole suite green, because nothing could reach
 * the difference.
 *
 * Rather than keep a branch that cannot fail, the invariant is asserted here,
 * at the one place that can make it false. These go red if the
 * `durationMs > 0` gate is loosened, if the arithmetic stops producing `NaN`
 * for an unparsable input, or if a future producer emits a duration without
 * checking its own timestamps.
 */
describe('judgeResponse — turn durations', () => {
  function pending(over: Partial<PendingResponse> = {}): PendingResponse {
    return {
      responseId: 'msg_1',
      timestamp: '2026-09-10T10:00:05.000Z',
      prevTimestamp: '2026-09-10T10:00:00.000Z',
      turnIndex: 0,
      outputTokens: 10,
      inputTokens: 5,
      thinkingChars: 0,
      errorText: '',
      isPostCompaction: false,
      ...over,
    }
  }

  it('yields a turn duration when both timestamps parse', () => {
    const { turnDuration } = judgeResponse(pending())
    expect(turnDuration).toBeDefined()
    expect(turnDuration!.durationMs).toBe(5000)
    expect(turnDuration!.assistantTimestamp).toBe('2026-09-10T10:00:05.000Z')
  })

  it('never yields a turn duration from a timestamp it could not parse', () => {
    // Unparsable assistant timestamp — the case `computeLatencyAnalytics`
    // documented a policy for and can never see.
    expect(judgeResponse(pending({ timestamp: 'invalid' })).turnDuration).toBeUndefined()
    // Unparsable previous timestamp — `NaN` from the other side of the
    // subtraction, equally never `> 0`.
    expect(judgeResponse(pending({ prevTimestamp: 'invalid' })).turnDuration).toBeUndefined()
    // Both unparsable: `NaN - NaN` is `NaN`, not 0.
    expect(
      judgeResponse(pending({ timestamp: 'invalid', prevTimestamp: 'nonsense' })).turnDuration
    ).toBeUndefined()
  })

  it('never yields a turn duration when either timestamp is absent', () => {
    expect(judgeResponse(pending({ timestamp: undefined })).turnDuration).toBeUndefined()
    expect(judgeResponse(pending({ prevTimestamp: undefined })).turnDuration).toBeUndefined()
  })

  /**
   * Taken together with the two above: every `TurnDuration` that exists
   * carries an `assistantTimestamp` that is present and parsable. This is the
   * property `computeLatencyAnalytics` states in its doc comment instead of
   * guarding for at runtime.
   */
  it('guarantees every emitted turn duration carries a parsable assistant timestamp', () => {
    const cases: Partial<PendingResponse>[] = [
      {},
      { timestamp: 'invalid' },
      { prevTimestamp: 'invalid' },
      { timestamp: undefined },
      { prevTimestamp: undefined },
      // Reversed order — a negative duration is rejected too, so this yields
      // nothing either.
      { timestamp: '2026-09-10T10:00:00.000Z', prevTimestamp: '2026-09-10T10:00:05.000Z' },
    ]
    const emitted = cases
      .map((c) => judgeResponse(pending(c)).turnDuration)
      .filter((t) => t !== undefined)

    expect(emitted.length).toBeGreaterThan(0)
    for (const td of emitted) {
      expect(td.assistantTimestamp).toBeDefined()
      expect(Number.isNaN(Date.parse(td.assistantTimestamp!))).toBe(false)
    }
  })
})
