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
 *
 * A sub-agent's conversation is read from its prompt down, so it mounts a
 * prefix instead and grows toward the tail; the same `windowAfterScroll` rule
 * applies, measured from the bottom.
 */

/** Records mounted when a transcript opens. */
export const INITIAL_RENDER_BATCH = 50
/** Records mounted each time the reader nears the unmounted edge. */
export const INCREMENT_RENDER_BATCH = 50
/** How close to the unmounted edge, in pixels, the next batch is mounted. */
export const RENDER_AHEAD_PX = 1500

/**
 * New window size after a scroll event. `distanceFromEdgePx` is how far the
 * reader is from the edge where unmounted records begin (the top of a
 * session, the bottom of a sub-agent's conversation); the window grows when
 * they come within `renderAheadPx` of it.
 */
export function windowAfterScroll(
  visibleCount: number,
  total: number,
  distanceFromEdgePx: number,
  batch: number,
  renderAheadPx: number
): number {
  if (visibleCount >= total) return total
  if (distanceFromEdgePx > renderAheadPx) return visibleCount
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

/**
 * New window size after a prefix window's record set changes — a running
 * sub-agent writing more. A reader who had every record mounted keeps seeing
 * the conversation as it grows; one still partway down keeps their window, and
 * the new records are mounted as they scroll toward them.
 */
export function prefixWindowAfterAppend(
  visibleCount: number,
  previousTotal: number,
  total: number
): number {
  // Nothing loaded on one side: a transcript opening or being swapped out,
  // not an append. The window keeps its size for the records that arrive.
  if (previousTotal === 0 || total === 0) return visibleCount
  if (visibleCount >= previousTotal) return Math.max(visibleCount, total)
  return Math.min(visibleCount, total)
}
