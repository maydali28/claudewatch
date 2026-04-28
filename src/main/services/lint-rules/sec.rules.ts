import * as path from 'path'
import type { LintResult, LintContext } from '@shared/types/lint'
import type { SessionSummary } from '@shared/types/session'
import { scanFileLines } from '@main/services/secret-scanner'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOOKBACK_SECRETS_DAYS = 30
const SEC_MIN_MESSAGES = 10
const SEC_MAX_TOTAL = 20
const LINES_TO_SCAN = 50

// ─── secRules ─────────────────────────────────────────────────────────────────

export async function secRules(
  context: LintContext,
  sessions: SessionSummary[]
): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir, settings } = context

  const cutoff = Date.now() - LOOKBACK_SECRETS_DAYS * 24 * 60 * 60 * 1000

  const eligibleSessions = sessions.filter((s) => {
    const messageCount = (s.userMessageCount ?? 0) + (s.assistantMessageCount ?? 0)
    return new Date(s.lastTimestamp).getTime() >= cutoff && messageCount >= SEC_MIN_MESSAGES
  })

  // Track per-pattern counts across all files for global cap
  const countPerPattern: Record<string, number> = {}
  const MAX_PER_PATTERN_FILE = 3

  for (const session of eligibleSessions) {
    if (results.length >= SEC_MAX_TOTAL) break

    const filePath = path.join(claudeDir, 'projects', session.projectId, `${session.id}.jsonl`)

    const findings = await scanFileLines(filePath, LINES_TO_SCAN)

    for (const finding of findings) {
      if (results.length >= SEC_MAX_TOTAL) break

      const patternCount = countPerPattern[finding.checkId] ?? 0
      if (patternCount >= MAX_PER_PATTERN_FILE) continue

      results.push({
        id: makeId(),
        checkId: finding.checkId,
        severity: finding.severity,
        filePath,
        line: finding.lineNumber,
        message: `${finding.patternName} found in session`,
        contextLines: [finding.lineText],
        maskedSecret: finding.maskedValue,
        subagentFileName: session.id,
        detectedAt: new Date().toISOString(),
      })

      countPerPattern[finding.checkId] = patternCount + 1
    }
  }

  // SEC008 — if CFG006 not set AND any SEC001–SEC007 found
  const hasCfg006 =
    (settings as Record<string, unknown> | undefined)?.['env'] !== undefined &&
    (settings as Record<string, Record<string, string>>)['env'][
      'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'
    ] !== undefined

  const hasSecrets = results.some((r) => r.checkId !== 'SEC008' && r.checkId.startsWith('SEC'))

  if (!hasCfg006 && hasSecrets && results.length < SEC_MAX_TOTAL) {
    results.push({
      id: makeId(),
      checkId: 'SEC008',
      severity: 'warning',
      filePath: path.join(claudeDir, 'settings.json'),
      message:
        'Credential leakage risk — secrets found in sessions and CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is not set',
      fix: 'Add CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=true to your env settings to prevent credential leakage.',
      detectedAt: new Date().toISOString(),
    })
  }

  return results
}
