import * as path from 'path'
import type { LintResult, LintContext } from '@shared/types/lint'
import type { SecretFindingRecord } from '@shared/types/secrets'
import { getSecretFindingsStore } from '@main/services/secret-scan-service'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEC_MAX_TOTAL = 20

// ─── secRules ─────────────────────────────────────────────────────────────────

export interface SecRulesDeps {
  /** The findings secret scanning has recorded, live or by a history scan. */
  findings: () => readonly SecretFindingRecord[]
}

const defaultDeps: SecRulesDeps = {
  findings: () => getSecretFindingsStore()?.list() ?? [],
}

/**
 * Health's secret checks report what secret scanning has already found. They
 * used to read the end of every recent transcript on their own each time
 * Health ran, with no consent, and handed the raw line (secret included) to
 * the window. Now no transcript is read here: scanning happens only with the
 * user's consent (live) or on request (history), and only masked values
 * leave main. Dismissed findings are left out; newest first, capped.
 */
export async function secRules(
  context: LintContext,
  deps: SecRulesDeps = defaultDeps
): Promise<LintResult[]> {
  const { claudeDir, settings } = context
  const active = deps
    .findings()
    .filter((f) => !f.dismissed)
    .sort((a, b) => (b.occurredAt ?? b.foundAt).localeCompare(a.occurredAt ?? a.foundAt))
    .slice(0, SEC_MAX_TOTAL)

  const results: LintResult[] = active.map((f) => {
    const sessionDir = path.join(claudeDir, 'projects', f.projectId)
    const filePath = f.agentId
      ? path.join(sessionDir, f.sessionId, 'subagents', `agent-${f.agentId}.jsonl`)
      : path.join(sessionDir, `${f.sessionId}.jsonl`)
    return {
      id: makeId(),
      checkId: f.checkId,
      severity: f.severity,
      filePath,
      ...(f.lineNumber !== undefined ? { line: f.lineNumber } : {}),
      message: `${f.patternName} found in a ${f.agentId ? 'sub-agent transcript' : 'session'}`,
      maskedSecret: f.maskedValue,
      subagentFileName: f.agentId ?? f.sessionId,
      detectedAt: f.foundAt,
    }
  })

  // SEC008 — if CFG006 not set AND any SEC001–SEC007 found
  const hasCfg006 =
    (settings as Record<string, unknown> | undefined)?.['env'] !== undefined &&
    (settings as Record<string, Record<string, string>>)['env'][
      'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'
    ] !== undefined

  if (!hasCfg006 && results.length > 0 && results.length < SEC_MAX_TOTAL) {
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
