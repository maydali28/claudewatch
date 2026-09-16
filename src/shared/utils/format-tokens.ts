/**
 * Ordered smallest-first. `formatTokens` walks this table rather than
 * repeating a threshold branch per unit: the previous shape repeated the same
 * "did rounding push the mantissa to 1000.0?" check once per unit and simply
 * omitted it for the largest one, so `999_999_999_999_999` rendered as
 * `1000.0T` — the exact four-digit mantissa the rest of the checks existed to
 * prevent. One table, one promotion loop, no unit that can be forgotten.
 */
const UNITS = [
  { suffix: 'K', div: 1_000 },
  { suffix: 'M', div: 1_000_000 },
  { suffix: 'B', div: 1_000_000_000 },
  { suffix: 'T', div: 1_000_000_000_000 },
] as const

/**
 * Format a raw token count to a human-readable string.
 *
 * `T` is the largest unit, so a value above ~1000T still renders with a wide
 * mantissa (`5000.0T`). That is deliberate and unreachable for a token count —
 * it would take a thousand trillion tokens — but it is the honest limit of the
 * table rather than a case that silently rounds into a wrong unit.
 */
export function formatTokens(count: number): string {
  if (count === 0) return '0'

  const isNegative = count < 0
  const abs = Math.abs(count)

  let formatted: string
  if (abs < UNITS[0].div) {
    formatted = String(abs)
  } else {
    // Largest unit this value reaches on magnitude alone…
    let i = 0
    while (i + 1 < UNITS.length && abs >= UNITS[i + 1].div) i++
    // …then promote again if rounding to one decimal pushed the mantissa to
    // 1000.0 (999_999_999 is 1000.0M before promotion, and 1.0B after).
    while (i + 1 < UNITS.length && Number((abs / UNITS[i].div).toFixed(1)) >= 1000) i++
    formatted = `${(abs / UNITS[i].div).toFixed(1)}${UNITS[i].suffix}`
  }

  return isNegative ? `-${formatted}` : formatted
}

/** Format token count with full label. */
export function formatTokensLong(count: number): string {
  return `${formatTokens(count)} tokens`
}
