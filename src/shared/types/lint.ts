import type { SessionSummary } from './session'

// ─── Severity ─────────────────────────────────────────────────────────────────

export type LintSeverity = 'error' | 'warning' | 'info'

// ─── Check IDs (all 45 rules) ─────────────────────────────────────────────────

export type LintCheckId =
  // CLAUDE.md checks
  | 'CMD001'
  | 'CMD002'
  | 'CMD003'
  | 'CMD006'
  | 'CMD_IMPORT'
  | 'CMD_DEPRECATE'
  // Rules checks
  | 'RUL001'
  | 'RUL002'
  | 'RUL003'
  | 'RUL005'
  // Skills checks
  | 'SKL001'
  | 'SKL002'
  | 'SKL003'
  | 'SKL004'
  | 'SKL005'
  | 'SKL006'
  | 'SKL007'
  | 'SKL008'
  | 'SKL009'
  | 'SKL012'
  | 'SKL_AGG'
  // Cross-cutting checks
  | 'XCT001'
  | 'XCT002'
  | 'XCT003'
  // Session health checks
  | 'SES001'
  | 'SES002'
  | 'SES003'
  | 'SES004'
  | 'SES005'
  | 'SES006'
  // Config health checks
  | 'CFG001'
  | 'CFG002'
  | 'CFG003'
  | 'CFG004'
  | 'CFG005'
  | 'CFG006'
  | 'CFG007'
  // Secret detection checks
  | 'SEC001'
  | 'SEC002'
  | 'SEC003'
  | 'SEC004'
  | 'SEC005'
  | 'SEC006'
  | 'SEC007'
  | 'SEC008'

// ─── Lint Result ──────────────────────────────────────────────────────────────

export interface LintResult {
  id: string
  severity: LintSeverity
  checkId: LintCheckId
  filePath: string
  line?: number
  message: string
  fix?: string
  displayPath?: string
  contextLines?: string[]
  maskedSecret?: string
  subagentFileName?: string
  detectedAt?: string // ISO date string
}

// ─── Lint Summary ─────────────────────────────────────────────────────────────

export interface LintSummary {
  errorCount: number
  warningCount: number
  infoCount: number
  /** 0.0–1.0, computed as max(0, 1 - (errors*3 + warnings) / (total*3)) */
  healthScore: number
}

// ─── Secret Alert (real-time) ─────────────────────────────────────────────────

export interface SecretAlert {
  checkId: LintCheckId
  patternName: string
  maskedValue: string
  sessionTitle: string
  projectId: string
  sessionId: string
  isSubagent: boolean
  detectedAt: string // ISO date string
}

// ─── Lint Context (passed to each rule function) ──────────────────────────────

export interface LintContext {
  claudeDir: string
  projectRoot?: string
  claudeMdContent?: string
  claudeMdPath?: string
  rulesDir?: string
  skillsDir?: string
  settings?: Record<string, unknown>
  sessions?: SessionSummary[]
}
