import { describe, expect, it } from 'vitest'
import { formatCost, formatCostDelta } from './format-cost'

describe('formatCost', () => {
  it('formats zero', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('formats a small positive value', () => {
    expect(formatCost(0.2)).toBe('$0.20')
  })

  it('puts the minus sign before the dollar sign for a small negative value', () => {
    // Regression: `$${usd.toFixed(2)}` on -0.2 used to render "$-0.20".
    expect(formatCost(-0.2)).toBe('-$0.20')
  })

  it('rounds a large positive value to whole dollars with thousands separators', () => {
    expect(formatCost(12345.67)).toBe('$12,346')
  })

  it('rounds a large negative value the same way, sign before the dollar sign', () => {
    expect(formatCost(-12345.67)).toBe('-$12,346')
  })
})

describe('formatCostDelta', () => {
  it('renders zero as a non-negative no-op', () => {
    expect(formatCostDelta(0)).toBe('+$0.00')
  })

  it('prefixes a small positive delta with +', () => {
    expect(formatCostDelta(0.2)).toBe('+$0.20')
  })

  it('prefixes a small negative delta with - and keeps the sign', () => {
    // Regression: `prefix = usd >= 0 ? '+' : ''` on a negative delta dropped
    // the sign entirely once combined with `formatCost(Math.abs(usd))` — a
    // loss rendered as "$0.20", indistinguishable from a gain.
    expect(formatCostDelta(-0.2)).toBe('-$0.20')
  })

  it('prefixes a large positive delta with + using the thousands format', () => {
    expect(formatCostDelta(12345.67)).toBe('+$12,346')
  })

  it('prefixes a large negative delta with - using the thousands format', () => {
    expect(formatCostDelta(-12345.67)).toBe('-$12,346')
  })
})
