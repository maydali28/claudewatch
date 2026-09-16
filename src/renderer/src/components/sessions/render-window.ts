/**
 * How much of a transcript stays mounted.
 *
 * The window is a suffix of the transcript, like any chat client: a session
 * opens on its newest records, scrolled to the bottom, and older records are
 * mounted as the reader scrolls up toward them. The panel previously mounted a
 * prefix and grew toward the tail, so a session with 3,827 records opened on
 * its very first message and the reader had to scroll through all of it to
 * reach the part that was still in progress.
 *
 * Kept as plain functions so the rule is testable without mounting React.
 */

/**
 * New window size after a scroll event. `distanceFromTopPx` is how far the
 * reader is from the oldest mounted record; the window grows when they come
 * within `renderAheadPx` of it.
 */
export function windowAfterScroll(
  visibleCount: number,
  total: number,
  distanceFromTopPx: number,
  batch: number,
  renderAheadPx: number
): number {
  if (visibleCount >= total) return total
  if (distanceFromTopPx > renderAheadPx) return visibleCount
  return Math.min(total, visibleCount + batch)
}

/**
 * New window size after the record set changes — a live session appending, or
 * a search filter narrowing it.
 *
 * The tail is always inside a suffix window, so an append is absorbed by
 * growing the window by the number of new records: the oldest mounted record
 * stays mounted, and nothing above the reader disappears when new turns land
 * below them.
 */
export function windowAfterAppend(
  visibleCount: number,
  previousTotal: number,
  total: number
): number {
  const appended = Math.max(0, total - previousTotal)
  return Math.min(total, visibleCount + appended)
}

/**
 * Scroll position that keeps the same record under the reader's eye after
 * older records were mounted above the viewport. The browser keeps
 * `scrollTop` across the insertion, which would throw the reader up by the
 * height of everything just added.
 */
export function scrollTopAfterPrepend(
  scrollTop: number,
  previousScrollHeight: number,
  scrollHeight: number
): number {
  return scrollTop + (scrollHeight - previousScrollHeight)
}
