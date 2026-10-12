import type { LintResult, LintContext } from '@shared/types/lint'
import type { SessionSummary } from '@shared/types/session'
import { evaluateSessionHealth } from '@shared/utils/session-health'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

const LOOKBACK_SESSIONS_DAYS = 7
const MAX_RESULTS = 10

function getSessionFilePath(claudeDir: string, projectId: string, sessionId: string): string {
  return `${claudeDir}/projects/${projectId}/${sessionId}.jsonl`
}

// At most one result per session, its most important failing check; the
// session's own Health tab lists them all.
function checkSession(session: SessionSummary, claudeDir: string): LintResult | null {
  const [first] = evaluateSessionHealth(session)
  if (!first) return null
  return {
    id: makeId(),
    checkId: first.checkId,
    severity: first.severity,
    filePath: getSessionFilePath(claudeDir, session.projectId, session.id),
    message: first.message,
    fix: first.fix,
    subagentFileName: session.id,
    session: { sessionId: session.id, projectId: session.projectId },
  }
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
