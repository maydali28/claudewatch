/** Format a cost in USD to a readable string with appropriate precision. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

/** Format a cost delta (positive = more expensive, negative = savings). */
export function formatCostDelta(usd: number): string {
  const prefix = usd >= 0 ? '+' : ''
  return `${prefix}${formatCost(Math.abs(usd))}`
}
