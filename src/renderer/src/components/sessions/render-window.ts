/**
 * How much of a transcript stays mounted.
 *
 * The panel previously expanded the render window on every idle tick until the
 * whole transcript was mounted, so opening a session with 3,827 records ended
 * up with 3,827 markdown-rendering components in the DOM whether or not the
 * reader ever scrolled past the first screen. The window now follows the
 * reader: it grows as they approach the rendered tail, and keeps up with a live
 * session only for someone who has actually read to the end.
 *
 * Kept as plain functions so the rule is testable without mounting React.
 */

/** New window size after a scroll event. */
export function windowAfterScroll(
  visibleCount: number,
  total: number,
  distanceFromBottomPx: number,
  batch: number,
  renderAheadPx: number
): number {
  if (visibleCount >= total) return total
  if (distanceFromBottomPx > renderAheadPx) return visibleCount
  return Math.min(total, visibleCount + batch)
}

/**
 * New window size after the record set changes — a live session appending, or a
 * search filter narrowing it.
 *
 * `reachedEnd` means the reader has already had the last record mounted at some
 * point; without it, opening a long session at the "bottom" of its first screen
 * would immediately mount the entire history.
 */
export function windowAfterAppend(
  visibleCount: number,
  total: number,
  reachedEnd: boolean,
  atBottom: boolean
): number {
  if (visibleCount > total) return total
  if (reachedEnd && atBottom) return total
  return visibleCount
}
