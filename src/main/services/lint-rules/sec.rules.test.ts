import { describe, expect, it } from 'vitest'
import { isSecretScanEligible, SEC_MIN_MESSAGES } from './sec.rules'

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
