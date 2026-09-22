/**
 * When a long message body gets a "Show more" control, and what the control
 * says. Kept as plain functions so the rule is testable without a DOM; the
 * measuring lives in `collapsible-text.tsx`.
 *
 * Clamped by rendered height, not character count: markdown makes character
 * counts a poor proxy (a short message with a code block is taller than a
 * long paragraph), and cutting a string mid-construct — an open code fence,
 * half a table — renders garbage.
 */

/**
 * Whether content of `contentHeightPx` needs the clamp at `maxHeightPx`.
 * Content only `slackPx` over the clamp is left alone: a button that reveals
 * two more lines is noise, and the clamp would hide less than the control
 * itself takes up.
 */
export function needsCollapse(
  contentHeightPx: number,
  maxHeightPx: number,
  slackPx: number
): boolean {
  return contentHeightPx > maxHeightPx + slackPx
}

/** Whole lines the clamp hides; zero when nothing is hidden or the line height is unknown. */
export function hiddenLines(
  contentHeightPx: number,
  maxHeightPx: number,
  lineHeightPx: number
): number {
  if (!(lineHeightPx > 0)) return 0
  return Math.max(0, Math.round((contentHeightPx - maxHeightPx) / lineHeightPx))
}
