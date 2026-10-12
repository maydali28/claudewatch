import type { LintCheckId, LintSeverity } from '@shared/types/lint'
import type { SessionSummary } from '@shared/types/session'
import { IDLE_GAP_MINUTES } from '@shared/constants/tuning'

// The session checks (SES001–SES006), in one place. The Health view runs them
// in main; the session list, the session header and the session's Health tab
// run them in the window. They used to be three copies with drifting rules
// (the window graded an error-rate-limited session a warning, main an error).

export const SESSION_HEALTH_THRESHOLDS = {
  costUsd: 25,
  compactions: 5,
  tokens: 2_000_000,
  staleDays: 14,
  // Halved when message counting moved from records to API responses: the old
  // value of 10 was calibrated against counts inflated ~2.09x.
  staleMinMessages: 5,
} as const

export interface SessionHealthCheck {
  checkId: LintCheckId
  severity: LintSeverity
  /** Short name of the check, for badges and tooltips. */
  title: string
  /** What was found in this session. */
  message: string
  fix: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const SEVERE_ERRORS = new Set(['rateLimit', 'authFailure', 'proxyError'])

/** Every session check that fails, most important first. */
export function evaluateSessionHealth(
  session: SessionSummary,
  now: number = Date.now()
): SessionHealthCheck[] {
  const t = SESSION_HEALTH_THRESHOLDS
  const checks: SessionHealthCheck[] = []
  const tokens = (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0)

  if (session.estimatedCost > t.costUsd) {
    checks.push({
      checkId: 'SES001',
      severity: 'warning',
      title: `Cost exceeds $${t.costUsd}`,
      message: `Session cost $${session.estimatedCost.toFixed(2)} exceeds $${t.costUsd.toFixed(2)} threshold`,
      fix: 'Consider starting a fresh session to avoid context saturation.',
    })
  }

  if (tokens > t.tokens) {
    checks.push({
      checkId: 'SES003',
      severity: 'warning',
      title: 'More than 2M tokens consumed',
      message: `Session consumed ${tokens.toLocaleString()} tokens (>2M)`,
      fix: 'Start a fresh session — context window saturation reduces quality.',
    })
  }

  if ((session.compactionCount ?? 0) >= t.compactions) {
    checks.push({
      checkId: 'SES002',
      severity: 'warning',
      title: `${t.compactions}+ compaction cycles`,
      message: `Session had ${session.compactionCount} compaction cycles (≥${t.compactions})`,
      fix: 'Frequent compaction indicates this session has grown very large.',
    })
  }

  const idleDays = (now - new Date(session.lastTimestamp).getTime()) / DAY_MS
  if (idleDays > t.staleDays && session.messageCount >= t.staleMinMessages) {
    checks.push({
      checkId: 'SES004',
      severity: 'info',
      title: `Stale session (${t.staleDays}+ days)`,
      message: `Session is stale (last activity ${Math.floor(idleDays)} days ago, ${session.messageCount} messages)`,
      fix: 'Archive or delete stale sessions you no longer need.',
    })
  }

  if (session.hasError) {
    const errorType = session.observability?.errorClassifications[0] ?? 'unknown'
    checks.push({
      checkId: 'SES005',
      severity: SEVERE_ERRORS.has(errorType) ? 'error' : 'warning',
      title: 'Error patterns detected',
      message: `Session has error patterns: ${errorType}`,
      fix: 'Review the session for unresolved errors.',
    })
  }

  if (session.observability?.hasIdleZombieGap) {
    checks.push({
      checkId: 'SES006',
      severity: 'warning',
      title: 'Idle gap without /clear',
      message: `Session has an idle gap >${IDLE_GAP_MINUTES} minutes without /clear (zombie session risk)`,
      fix: 'Use /clear between distinct tasks to avoid zombie context.',
    })
  }

  return checks
}

const RANK: Record<LintSeverity, number> = { error: 3, warning: 2, info: 1 }

/** The most severe of several severities, or null for none. */
export function worstSeverity(severities: LintSeverity[]): LintSeverity | null {
  let worst: LintSeverity | null = null
  for (const s of severities) if (!worst || RANK[s] > RANK[worst]) worst = s
  return worst
}
