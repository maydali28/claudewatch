import type { SessionDayUsage, SessionSummary } from '@shared/types/session'
import type { CostAlert, CostAlertThresholds } from '@shared/types/cost-alerts'
import { toDateKey } from '@shared/utils/date-ranges'
import { formatCost } from '@shared/utils/format-cost'

// Cost alerts from Settings › Alerts: a daily budget across every session and
// a per-session limit. Checked each time a session's transcript changes, from
// the summary the watcher just parsed. Each alert fires once: the budget once
// per calendar day, the limit once per session. What was already over when the
// app started is recorded, not announced, so a restart does not repeat alerts.

/** The fields the checks read; a `SessionSummary` has them all. */
export type CostedSession = Pick<SessionSummary, 'id' | 'projectId' | 'title' | 'estimatedCost'> & {
  dailyUsage: Pick<SessionDayUsage, 'day' | 'estimatedCost'>[]
}

export type { CostAlert, CostAlertThresholds }

/** Estimated cost of every session's usage on `day` (local `YYYY-MM-DD`). */
export function todaysCost(sessions: readonly CostedSession[], day: string): number {
  let total = 0
  for (const session of sessions) {
    for (const d of session.dailyUsage) if (d.day === day) total += d.estimatedCost
  }
  return total
}

const isOn = (threshold: number | undefined): threshold is number =>
  threshold !== undefined && threshold > 0

export class CostAlertTracker {
  /** The day the budget alert last fired (or was found already passed). */
  private dailyFiredOn: string | null = null
  private sessionsFired = new Set<string>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Record what is already over, without alerting. Run once at startup. */
  baseline(sessions: readonly CostedSession[], thresholds: CostAlertThresholds): void {
    const day = toDateKey(this.now())
    if (isOn(thresholds.daily) && todaysCost(sessions, day) > thresholds.daily) {
      this.dailyFiredOn = day
    }
    if (isOn(thresholds.session)) {
      for (const s of sessions)
        if (s.estimatedCost > thresholds.session) this.sessionsFired.add(s.id)
    }
  }

  /** Alerts newly due after `updated` changed; `sessions` already holds its new figures. */
  check(
    updated: CostedSession,
    sessions: readonly CostedSession[],
    thresholds: CostAlertThresholds
  ): CostAlert[] {
    const alerts: CostAlert[] = []
    const day = toDateKey(this.now())
    if (isOn(thresholds.daily) && this.dailyFiredOn !== day) {
      const cost = todaysCost(sessions, day)
      if (cost > thresholds.daily) {
        this.dailyFiredOn = day
        alerts.push({ kind: 'daily', day, cost, threshold: thresholds.daily })
      }
    }
    if (
      isOn(thresholds.session) &&
      !this.sessionsFired.has(updated.id) &&
      updated.estimatedCost > thresholds.session
    ) {
      this.sessionsFired.add(updated.id)
      alerts.push({
        kind: 'session',
        sessionId: updated.id,
        projectId: updated.projectId,
        title: updated.title,
        cost: updated.estimatedCost,
        threshold: thresholds.session,
      })
    }
    return alerts
  }
}

/** Notification text. Costs are estimates (see L11), and say so. */
export function describeCostAlert(alert: CostAlert): { title: string; body: string } {
  if (alert.kind === 'daily') {
    return {
      title: 'Daily budget passed',
      body: `Estimated spend today is ${formatCost(alert.cost)}, over your ${formatCost(alert.threshold)} daily budget.`,
    }
  }
  return {
    title: 'Session cost limit passed',
    body: `“${alert.title}” has an estimated cost of ${formatCost(alert.cost)}, over your ${formatCost(alert.threshold)} limit.`,
  }
}
