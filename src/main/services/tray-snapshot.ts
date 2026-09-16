import type { SessionSummary } from '@shared/types/session'
import type { Project } from '@shared/types/project'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import type { TraySnapshot, TraySnapshotSession } from '@shared/types/analytics'
import { computeAnalytics, buildSessionOwnerMap } from './analytics-engine'
import { partitionLiveSessions } from '@shared/utils/live-session'
import { toDateKey, compareTimestampsAscending } from '@shared/utils/date-ranges'

/**
 * Build everything the tray popover renders from one already-committed scan.
 *
 * The tray used to make three calls — today's analytics, the week's analytics,
 * and listProjects — and the last forced a full discovery scan of every
 * transcript on every open and every 30-second refresh. Only the displayed
 * fields cross the boundary now, and only a handful of sessions rather than all
 * of them.
 */
export function buildTraySnapshot(
  projects: Project[],
  pricingTable: Record<ModelFamily, ModelPricing>,
  now: number = Date.now()
): TraySnapshot {
  const sessions = projects.flatMap((p) => p.sessions)

  // One pass. Today is the last point of the seven-day series, looked up by
  // local date key; a second full analytics pass recomputed cache, latency,
  // effort, health and compaction domains the tray never displays just to
  // read four numbers that a single day's row already carries.
  const week = computeAnalytics(sessions, projects, '7d', pricingTable)
  const todayKey = toDateKey(new Date())
  const todayRow = week.dailyUsage.find((d) => d.date === todayKey)

  // `projectCosts.length` is a distinct-project count over whichever range
  // produced it. The week's version counts every project touched at any
  // point in the last 7 days, which is not today's figure — daily rows carry
  // no per-project breakdown to recover it from, so it is derived separately
  // here instead of resurrecting a second full analytics pass for one field.
  const projectCount = todaysProjectCount(sessions, todayKey, buildSessionOwnerMap(projects))

  // Descending by time, via `compareTimestampsAscending` (arguments swapped,
  // not negated) rather than subtracting two `getTime()`s directly: `sessions`
  // here is every session across every project, unfiltered for parseable
  // timestamps, so a raw subtraction could return `NaN` and break
  // `Array.prototype.sort`'s contract.
  const sorted = [...sessions].sort((a, b) =>
    compareTimestampsAscending(b.lastTimestamp, a.lastTimestamp)
  )
  // The same rule the popover and the dashboard row apply — see
  // `isSessionLive` for why an open turn extends the window, and
  // `partitionLiveSessions` for the recent list's cap.
  const { active, recent } = partitionLiveSessions(sorted, now)

  return {
    today: {
      // `'7d'` is a bounded preset, so `week.dailyUsage` is zero-filled to
      // its full 7 calendar days (see `analytics-engine.ts`) and `todayRow`
      // is never actually missing — but the `?? 0`/ternary defaults are kept
      // as a safety net rather than asserted non-null, since this reads
      // across the IPC boundary from a value this function does not itself
      // guarantee the shape of.
      sessionCount: todayRow?.sessionCount ?? 0,
      tokenCount: todayRow ? todayRow.inputTokens + todayRow.outputTokens : 0,
      messageCount: todayRow?.messageCount ?? 0,
      cost: todayRow?.estimatedCost ?? 0,
      projectCount,
    },
    // `week.dailyUsage` already carries all 7 calendar days, idle ones
    // included (see above) — the renderer's `buildWeeklyUsage` re-applies
    // the same zero-fill on top of this, which is redundant but harmless
    // (idempotent), kept so it still degrades safely if this ever received
    // a sparse series again (e.g. a future `all`-scoped caller).
    weekly: week.dailyUsage.map((d) => ({
      date: d.date,
      tokens: d.inputTokens + d.outputTokens,
      cost: d.estimatedCost,
    })),
    activeSessions: active.map(toTraySession),
    recentSessions: recent.map(toTraySession),
  }
}

/**
 * Distinct projects with activity on `todayKey`.
 *
 * Mirrors `daysInRange`'s gate (`dailyUsage ?? []`) — the one `buildProjectCosts`
 * actually filters through — not `filterByDateRange`'s broader fallback that
 * admits a legacy session by `lastTimestamp` when it has no `dailyUsage`. Those
 * two membership rules already disagree once in this codebase: a session with
 * an empty `dailyUsage` array is real activity to the outer, lastTimestamp-based
 * filter but invisible to every day-keyed rollup (`buildDailyUsage`,
 * `buildProjectCosts`) because they only ever read its `dailyUsage`. Using the
 * outer rule here counted a project the day row's `sessionCount` above does
 * not — so this has to use the same inner gate `sessionCount` gets for free
 * from `dailyUsage`, or the two derived fields disagree with each other on
 * what "active today" means.
 *
 * `ownerOf` resolves each session to the id of the (possibly merged) `Project`
 * that owns it — see `analytics-engine.ts`'s `buildSessionOwnerMap`, which
 * `buildProjectCosts` uses for the identical reason. Counting distinct
 * `s.projectId` directly, the session's own PHYSICAL directory, split one
 * merged project (a checkout plus its git worktrees) back into up to N
 * distinct entries here: the tray reported `projectCount: 3` for one project
 * merged from three worktree directories, even though its token/cost totals
 * (built from the SAME `sessions`, summed rather than counted) were already
 * correct.
 */
function todaysProjectCount(
  sessions: SessionSummary[],
  todayKey: string,
  ownerOf: Map<string, string>
): number {
  const activeToday = (s: SessionSummary): boolean =>
    (s.dailyUsage ?? []).some((d) => d.day === todayKey)
  return new Set(sessions.filter(activeToday).map((s) => ownerOf.get(s.id) ?? s.projectId)).size
}

function toTraySession(s: SessionSummary): TraySnapshotSession {
  return {
    id: s.id,
    projectId: s.projectId,
    projectPath: s.projectPath,
    title: s.title,
    slug: s.slug,
    latestModel: s.latestModel,
    messageCount: s.messageCount,
    totalInputTokens: s.totalInputTokens,
    totalOutputTokens: s.totalOutputTokens,
    lastTimestamp: s.lastTimestamp,
    turnOpen: s.turnOpen,
    hasError: s.hasError,
  }
}
