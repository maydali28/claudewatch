import type { CostAlertThresholds } from '@shared/types/cost-alerts'
import { formatCost } from '@shared/utils/format-cost'

// The tray's standing reminder that a cost limit is passed. The alert itself
// fires once; this stays until the day or the setting changes. A threshold of
// 0 or a missing threshold means that alert is off.

/** Text for the tray's budget line, or null while under budget. */
export function dailyBudgetNotice(todayCost: number, limits: CostAlertThresholds): string | null {
  const budget = limits.daily ?? 0
  if (budget <= 0 || todayCost <= budget) return null
  return `Over daily budget · ${formatCost(todayCost)} of ${formatCost(budget)}`
}

/** Tooltip for a session row's cost, or null while under the limit. */
export function sessionLimitNotice(cost: number, limits: CostAlertThresholds): string | null {
  const limit = limits.session ?? 0
  if (limit <= 0 || cost <= limit) return null
  return `Over your ${formatCost(limit)} session limit`
}
