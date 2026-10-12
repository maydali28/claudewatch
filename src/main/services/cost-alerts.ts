import type { SessionDayUsage, SessionSummary } from '@shared/types/session'
import type { CostAlert, CostAlertThresholds } from '@shared/types/cost-alerts'
import { toDateKey } from '@shared/utils/date-ranges'
import { formatCost } from '@shared/utils/format-cost'

// Cost alerts from Settings › Alerts: a daily budget across every session and
// a per-session limit. Checked each time a session's transcript changes, from
// the summary the watcher just parsed. Each alert fires once: the budget once
// per calendar day, the limit once per session. What was announced is kept in
// a store, so a restart neither repeats an alert nor swallows one that came
// due while the app was not running.

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

/** What has been announced, kept across restarts. */
export interface CostAlertState {
  /** The day the budget alert last fired. */
  dailyFiredOn: string | null
  /** Sessions whose limit alert fired, or that were already over when first seen. */
  sessionsFired: string[]
}

export interface CostAlertStateStore {
  load(): CostAlertState
  save(state: CostAlertState): void
}

/** A store that lives as long as the process; the default, and for tests. */
export function memoryCostAlertState(): CostAlertStateStore {
  let state: CostAlertState = { dailyFiredOn: null, sessionsFired: [] }
  return {
    load: () => ({ ...state, sessionsFired: [...state.sessionsFired] }),
    save: (next) => {
      state = { ...next, sessionsFired: [...next.sessionsFired] }
    },
  }
}

export class CostAlertTracker {
  private dailyFiredOn: string | null
  private sessionsFired: Set<string>
  private readonly store: CostAlertStateStore
  private readonly now: () => Date

  constructor(opts: { store?: CostAlertStateStore; now?: () => Date } = {}) {
    this.store = opts.store ?? memoryCostAlertState()
    this.now = opts.now ?? (() => new Date())
    const state = this.store.load()
    this.dailyFiredOn = state.dailyFiredOn
    this.sessionsFired = new Set(state.sessionsFired)
  }

  private persist(): void {
    this.store.save({ dailyFiredOn: this.dailyFiredOn, sessionsFired: [...this.sessionsFired] })
  }

  /**
   * Run once at startup, on every session. Returns what came due while the app
   * was not running and was never announced: the budget, and the limit of each
   * session used today. Older sessions over the limit are recorded without an
   * alert, so turning the limit on does not announce last month's sessions.
   */
  start(sessions: readonly CostedSession[], thresholds: CostAlertThresholds): CostAlert[] {
    const alerts: CostAlert[] = []
    const day = toDateKey(this.now())
    const present = new Set(sessions.map((s) => s.id))
    for (const id of this.sessionsFired) if (!present.has(id)) this.sessionsFired.delete(id)

    if (isOn(thresholds.daily) && this.dailyFiredOn !== day) {
      const cost = todaysCost(sessions, day)
      if (cost > thresholds.daily) {
        this.dailyFiredOn = day
        alerts.push({ kind: 'daily', day, cost, threshold: thresholds.daily })
      }
    }
    if (isOn(thresholds.session)) {
      for (const s of sessions) {
        if (this.sessionsFired.has(s.id) || s.estimatedCost <= thresholds.session) continue
        this.sessionsFired.add(s.id)
        const usedToday = s.dailyUsage.some((d) => d.day === day && d.estimatedCost > 0)
        if (usedToday) alerts.push(sessionAlert(s, thresholds.session))
      }
    }
    this.persist()
    return alerts
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
      alerts.push(sessionAlert(updated, thresholds.session))
    }
    if (alerts.length > 0) this.persist()
    return alerts
  }
}

function sessionAlert(s: CostedSession, threshold: number): CostAlert {
  return {
    kind: 'session',
    sessionId: s.id,
    projectId: s.projectId,
    title: s.title,
    cost: s.estimatedCost,
    threshold,
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
