/**
 * Format a cost in USD to a readable string with appropriate precision.
 *
 * Costs are usually non-negative, but `netSavings`-style quantities can be
 * negative by design (a write-heavy caching window costs more than it saves),
 * so the sign is handled explicitly rather than left to string concatenation
 * — `` `$${usd.toFixed(2)}` `` on a negative number renders "$-0.20", with the
 * minus landing after the currency symbol instead of before it.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  const sign = usd < 0 ? '-' : ''
  const abs = Math.abs(usd)
  if (abs < 100) return `${sign}$${abs.toFixed(2)}`
  return `${sign}$${Math.round(abs).toLocaleString()}`
}

/**
 * Format a cost delta with an explicit sign (positive = more expensive,
 * negative = savings). Zero is treated as a non-negative no-op and renders
 * "+$0.00", matching the positive branch rather than reading as a loss.
 */
export function formatCostDelta(usd: number): string {
  const prefix = usd < 0 ? '-' : '+'
  return `${prefix}${formatCost(Math.abs(usd))}`
}
