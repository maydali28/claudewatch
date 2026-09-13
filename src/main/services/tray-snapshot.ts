import type { SessionSummary } from '@shared/types/session'
import type { Project } from '@shared/types/project'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import type { TraySnapshot, TraySnapshotSession } from '@shared/types/analytics'
import { computeAnalytics } from './analytics-engine'
import { ACTIVE_SESSION_MS, TRAY_RECENT_SESSION_COUNT } from '@shared/constants/tuning'

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

  const today = computeAnalytics(sessions, projects, 'today', pricingTable)
  const week = computeAnalytics(sessions, projects, '7d', pricingTable)

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  )
  const isActive = (s: SessionSummary): boolean =>
    now - new Date(s.lastTimestamp).getTime() < ACTIVE_SESSION_MS

  return {
    today: {
      sessionCount: today.totalSessions,
      tokenCount: today.totalTokens,
      messageCount: today.totalMessages,
      cost: today.totalCost,
      projectCount: today.projectCosts.length,
    },
    // The renderer fills the calendar week; this carries only the days that
    // have data, keeping the payload small.
    weekly: week.dailyUsage.map((d) => ({
      date: d.date,
      tokens: d.inputTokens + d.outputTokens,
      cost: d.estimatedCost,
    })),
    activeSessions: sorted.filter(isActive).map(toTraySession),
    recentSessions: sorted
      .filter((s) => !isActive(s))
      .slice(0, TRAY_RECENT_SESSION_COUNT)
      .map(toTraySession),
  }
}

function toTraySession(s: SessionSummary): TraySnapshotSession {
  return {
    id: s.id,
    projectId: s.projectId,
    projectPath: s.projectPath,
    title: s.title,
    slug: s.slug,
    latestModel: s.latestModel,
    primaryModel: s.primaryModel,
    messageCount: s.messageCount,
    totalInputTokens: s.totalInputTokens,
    totalOutputTokens: s.totalOutputTokens,
    lastTimestamp: s.lastTimestamp,
    hasError: s.hasError,
  }
}
