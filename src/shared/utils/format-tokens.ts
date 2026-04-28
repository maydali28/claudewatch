/** Format a raw token count to a human-readable string. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}

/** Format token count with full label. */
export function formatTokensLong(count: number): string {
  return `${formatTokens(count)} tokens`
}
