import type { ContextFill } from '@shared/types/session'
import { formatTokens } from '@shared/utils/format-tokens'

/** Past this share the session is getting close to its window. */
const WARNING_PERCENT = 80
/** Claude Code auto-compacts just past this (~96.7% on a 1M window). */
const CRITICAL_PERCENT = 95

export type ContextFillLevel = 'normal' | 'warning' | 'critical'

export interface ContextFillView {
  /** Bar width, 0–100. */
  percent: number
  /** Short form for the meta row, e.g. `34% of 200K`. Absent with no data. */
  label?: string
  level: ContextFillLevel
  /** Tooltip text. */
  description: string
}

/** `200K`, `1M`: windows are round numbers, so no `.0`. */
function windowName(fill: ContextFill): string {
  const name = formatTokens(fill.window).replace('.0', '')
  return fill.windowEstimated ? `~${name}` : name
}

export function contextFillView(
  fill: ContextFill | undefined,
  compactionCount = 0
): ContextFillView {
  if (!fill || fill.window <= 0) {
    return { percent: 0, level: 'normal', description: 'No context recorded yet' }
  }
  const percent = Math.min(100, (fill.tokens / fill.window) * 100)
  const level: ContextFillLevel =
    percent >= CRITICAL_PERCENT ? 'critical' : percent >= WARNING_PERCENT ? 'warning' : 'normal'
  const window = windowName(fill)
  const parts = [`${formatTokens(fill.tokens)} of ${window} context`]
  if (fill.windowEstimated) parts[0] += ' (estimated window)'
  if (compactionCount > 0) parts.push(`compacted ${compactionCount}×`)
  return {
    percent,
    label: `${Math.floor(percent)}% of ${window}`,
    level,
    description: parts.join(' · '),
  }
}
