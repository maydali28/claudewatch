import { describe, it, expect } from 'vitest'
import { formatTokens, formatTokensLong } from './format-tokens'

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [12_345, '12.3K'],
    [2_500_000, '2.5M'],
    [1_000_000_000, '1.0B'],
    [2_500_000_000, '2.5B'],
    [1_500_000_000_000, '1.5T'],
  ])('formats %i as %s', (n, expected) => {
    expect(formatTokens(n)).toBe(expected)
  })

  it('never renders a four-digit mantissa below the largest unit', () => {
    // One case per boundary a rounding promotion has to cross. The original
    // implementation guarded K/M/B and forgot T, so the defect it was written
    // to prevent reappeared at the top of the range.
    for (const n of [999_999, 999_999_999, 999_999_999_999]) {
      expect(formatTokens(n)).not.toMatch(/^\d{4}/)
    }
  })

  it('promotes a rounded mantissa into the next unit at every boundary', () => {
    expect(formatTokens(999_999)).toBe('1.0M')
    expect(formatTokens(999_999_999)).toBe('1.0B')
    expect(formatTokens(999_999_999_999)).toBe('1.0T')
  })

  it('has no unit above T, so a value past 1000T keeps a wide mantissa', () => {
    // Documents the table's honest limit rather than pretending it is covered:
    // there is nothing to promote into. A token count cannot reach this.
    expect(formatTokens(999_999_999_999_999)).toBe('1000.0T')
    expect(formatTokens(5_000_000_000_000_000)).toBe('5000.0T')
  })

  it('handles edge cases around unit boundaries', () => {
    expect(formatTokens(999)).toBe('999')
    // When rounding would produce 1000.0, bump to next unit to avoid four-digit mantissa
    expect(formatTokens(999_999)).toBe('1.0M')
    expect(formatTokens(999_999_999)).toBe('1.0B')
    expect(formatTokens(999_999_999_999)).toBe('1.0T')
  })

  it('handles zero', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('handles negative numbers', () => {
    expect(formatTokens(-1)).toBe('-1')
    expect(formatTokens(-100)).toBe('-100')
    expect(formatTokens(-1000)).toBe('-1.0K')
    expect(formatTokens(-1_000_000)).toBe('-1.0M')
    expect(formatTokens(-1_000_000_000)).toBe('-1.0B')
    expect(formatTokens(-1_000_000_000_000)).toBe('-1.0T')
  })

  it('rounds properly at scale boundaries', () => {
    expect(formatTokens(1_500)).toBe('1.5K')
    expect(formatTokens(1_550)).toBe('1.6K')
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatTokens(1_550_000)).toBe('1.6M')
    expect(formatTokens(1_500_000_000)).toBe('1.5B')
    expect(formatTokens(1_550_000_000)).toBe('1.6B')
  })
})

describe('formatTokensLong', () => {
  it('formats tokens with full label', () => {
    expect(formatTokensLong(12_345)).toBe('12.3K tokens')
    expect(formatTokensLong(1_000_000_000)).toBe('1.0B tokens')
  })
})
