import type { LintResult, LintContext } from '@shared/types/lint'
import type { SessionSummary } from '@shared/types/session'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SES001_COST_THRESHOLD = 25.0
const SES002_COMPACTION_COUNT = 5
const SES003_TOKEN_THRESHOLD = 2_000_000
const SES004_STALE_DAYS = 14
const SES004_MIN_MESSAGES = 10
const LOOKBACK_SESSIONS_DAYS = 7
const MAX_RESULTS = 10

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime()
  return ms / (1000 * 60 * 60 * 24)
}

function getSessionFilePath(claudeDir: string, projectId: string, sessionId: string): string {
  return `${claudeDir}/projects/${projectId}/${sessionId}.jsonl`
}

// ─── Per-session rule checks (returns at most 1 per session — priority order) ─

function checkSession(session: SessionSummary, claudeDir: string): LintResult | null {
  const filePath = getSessionFilePath(claudeDir, session.projectId, session.id)
  const messageCount = session.messageCount

  // Priority: SES001 > SES003 > SES002 > SES004 > SES005 > SES006

  // SES001 — high cost
  if (session.estimatedCost > SES001_COST_THRESHOLD) {
    return {
      id: makeId(),
      checkId: 'SES001',
      severity: 'warning',
      filePath,
      message: `Session cost $${(session.estimatedCost ?? 0).toFixed(2)} exceeds $${SES001_COST_THRESHOLD.toFixed(2)} threshold`,
      fix: 'Consider starting a fresh session to avoid context saturation.',
      subagentFileName: session.id,
    }
  }

  // SES003 — high tokens
  const totalTokens = (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0)
  if (totalTokens > SES003_TOKEN_THRESHOLD) {
    return {
      id: makeId(),
      checkId: 'SES003',
      severity: 'warning',
      filePath,
      message: `Session consumed ${totalTokens.toLocaleString()} tokens (>2M)`,
      fix: 'Start a fresh session — context window saturation reduces quality.',
      subagentFileName: session.id,
    }
  }

  // SES002 — too many compactions
  if ((session.compactionCount ?? 0) >= SES002_COMPACTION_COUNT) {
    return {
      id: makeId(),
      checkId: 'SES002',
      severity: 'warning',
      filePath,
      message: `Session had ${session.compactionCount} compaction cycles (≥${SES002_COMPACTION_COUNT})`,
      fix: 'Frequent compaction indicates this session has grown very large.',
      subagentFileName: session.id,
    }
  }

  // SES004 — stale session
  if (daysSince(session.lastTimestamp) > SES004_STALE_DAYS && messageCount >= SES004_MIN_MESSAGES) {
    return {
      id: makeId(),
      checkId: 'SES004',
      severity: 'info',
      filePath,
      message: `Session is stale (last activity ${Math.floor(daysSince(session.lastTimestamp))} days ago, ${messageCount} messages)`,
      fix: 'Archive or delete stale sessions you no longer need.',
      subagentFileName: session.id,
    }
  }

  // SES005 — error patterns
  if (session.hasError) {
    const classifications = session.observability.errorClassifications
    const errorType = classifications[0] ?? 'unknown'
    const isSevere =
      errorType === 'rateLimit' || errorType === 'authFailure' || errorType === 'proxyError'
    return {
      id: makeId(),
      checkId: 'SES005',
      severity: isSevere ? 'error' : 'warning',
      filePath,
      message: `Session has error patterns: ${errorType}`,
      fix: 'Review the session for unresolved errors.',
      subagentFileName: session.id,
    }
  }

  // SES006 — idle/zombie gap
  if (session.observability?.hasIdleZombieGap) {
    return {
      id: makeId(),
      checkId: 'SES006',
      severity: 'warning',
      filePath,
      message: 'Session has an idle gap >75 minutes without /clear (zombie session risk)',
      fix: 'Use /clear between distinct tasks to avoid zombie context.',
      subagentFileName: session.id,
    }
  }

  return null
}

// ─── sesRules ─────────────────────────────────────────────────────────────────

export async function sesRules(
  context: LintContext,
  sessions: SessionSummary[]
): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir } = context
  const cutoff = Date.now() - LOOKBACK_SESSIONS_DAYS * 24 * 60 * 60 * 1000

  const recentSessions = sessions.filter((s) => {
    return new Date(s.lastTimestamp).getTime() >= cutoff
  })

  for (const session of recentSessions) {
    if (results.length >= MAX_RESULTS) break
    const result = checkSession(session, claudeDir)
    if (result) results.push(result)
  }

  return results
}
