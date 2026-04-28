import * as fs from 'fs'
import * as path from 'path'
import type { LintResult, LintSummary, LintContext } from '@shared/types/lint'
import type { SessionSummary } from '@shared/types/session'
import { getClaudeDir } from './project-scanner'
import { readRawSettings } from './config-service'
import { cmdRules } from './lint-rules/cmd.rules'
import { rulRules } from './lint-rules/rul.rules'
import { sklRules } from './lint-rules/skl.rules'
import { xctRules } from './lint-rules/xct.rules'
import { sesRules } from './lint-rules/ses.rules'
import { cfgRules } from './lint-rules/cfg.rules'
import { secRules } from './lint-rules/sec.rules'

// ─── buildContext ─────────────────────────────────────────────────────────────

async function buildContext(projectEncodedId?: string): Promise<LintContext> {
  const claudeDir = getClaudeDir()

  // Read global CLAUDE.md
  let claudeMdContent: string | undefined
  let claudeMdPath: string | undefined
  const globalClaudeMd = path.join(claudeDir, 'CLAUDE.md')
  try {
    claudeMdContent = await fs.promises.readFile(globalClaudeMd, 'utf-8')
    claudeMdPath = globalClaudeMd
  } catch {
    // No CLAUDE.md
  }

  // If project is specified, prefer project CLAUDE.md
  if (projectEncodedId) {
    const projectClaudeMd = path.join(claudeDir, 'projects', projectEncodedId, 'CLAUDE.md')
    try {
      claudeMdContent = await fs.promises.readFile(projectClaudeMd, 'utf-8')
      claudeMdPath = projectClaudeMd
    } catch {
      // Fall back to global
    }
  }

  const settings = await readRawSettings(projectEncodedId)
  const rulesDir = path.join(claudeDir, 'rules')
  const skillsDir = path.join(claudeDir, 'skills')

  // Resolve project root from projectEncodedId if available
  let projectRoot: string | undefined
  if (projectEncodedId) {
    // URL-decode the project dir name to get original path
    try {
      projectRoot = decodeURIComponent(projectEncodedId.replace(/-/g, '/'))
    } catch {
      // leave undefined
    }
  }

  return {
    claudeDir,
    projectRoot,
    claudeMdContent,
    claudeMdPath,
    rulesDir,
    skillsDir,
    settings: settings as Record<string, unknown>,
  }
}

// ─── computeLintSummary ───────────────────────────────────────────────────────

export function computeLintSummary(results: LintResult[]): LintSummary {
  const errorCount = results.filter((r) => r.severity === 'error').length
  const warningCount = results.filter((r) => r.severity === 'warning').length
  const infoCount = results.filter((r) => r.severity === 'info').length
  const total = results.length

  // healthScore = max(0, 1 - (errors*3 + warnings) / (total*3))
  const healthScore =
    total === 0 ? 1.0 : Math.max(0, 1 - (errorCount * 3 + warningCount) / (total * 3))

  return { errorCount, warningCount, infoCount, healthScore }
}

// ─── runAll ───────────────────────────────────────────────────────────────────

export async function runAll(
  sessions: SessionSummary[],
  projectEncodedId?: string
): Promise<LintResult[]> {
  const context = await buildContext(projectEncodedId)

  // Run all rule categories in parallel
  const [cmd, rul, skl, xct, ses, cfg, sec] = await Promise.all([
    cmdRules(context),
    rulRules(context),
    sklRules(context),
    xctRules(context),
    sesRules(context, sessions),
    cfgRules(context),
    secRules(context, sessions),
  ])

  const all = [...cmd, ...rul, ...skl, ...xct, ...ses, ...cfg, ...sec]

  // Deduplicate by checkId + filePath + line (same rule firing on same location)
  const seen = new Set<string>()
  const deduped: LintResult[] = []
  for (const result of all) {
    const key = `${result.checkId}:${result.filePath}:${result.line ?? 0}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(result)
    }
  }

  return deduped
}
