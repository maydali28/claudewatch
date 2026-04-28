import type { LintCheckId, LintSeverity } from '@shared/types/lint'

export interface LintRuleMeta {
  id: LintCheckId
  severity: LintSeverity
  category: string
  description: string
}

export const LINT_RULE_META: LintRuleMeta[] = [
  // ─── CLAUDE.md checks ──────────────────────────────────────────────────────
  {
    id: 'CMD001',
    severity: 'warning',
    category: 'CLAUDE.md',
    description: 'CLAUDE.md exceeds 200 lines (dilutes instruction priority)',
  },
  {
    id: 'CMD002',
    severity: 'info',
    category: 'CLAUDE.md',
    description: 'CLAUDE.md exceeds 100 lines without a .claude/rules/ directory',
  },
  {
    id: 'CMD003',
    severity: 'warning',
    category: 'CLAUDE.md',
    description: 'File-type patterns (*.ext) appear 3+ times — use scoped rules instead',
  },
  {
    id: 'CMD006',
    severity: 'error',
    category: 'CLAUDE.md',
    description: 'Unclosed code block (odd number of ``` fences)',
  },
  {
    id: 'CMD_IMPORT',
    severity: 'warning',
    category: 'CLAUDE.md',
    description: '@import chain depth exceeds 5 hops',
  },
  {
    id: 'CMD_DEPRECATE',
    severity: 'warning',
    category: 'CLAUDE.md',
    description: '.claude/commands/ directory exists (deprecated — use skills instead)',
  },
  // ─── Rules checks ──────────────────────────────────────────────────────────
  {
    id: 'RUL001',
    severity: 'error',
    category: 'Rules',
    description: 'Malformed YAML frontmatter (opening --- but no closing ---)',
  },
  {
    id: 'RUL002',
    severity: 'error',
    category: 'Rules',
    description: 'Invalid glob syntax (unmatched brackets, braces, or empty pattern)',
  },
  {
    id: 'RUL003',
    severity: 'info',
    category: 'Rules',
    description: 'Glob pattern matches no files in project',
  },
  {
    id: 'RUL005',
    severity: 'warning',
    category: 'Rules',
    description: 'Rule file exceeds 100 lines',
  },
  // ─── Skills checks ─────────────────────────────────────────────────────────
  {
    id: 'SKL001',
    severity: 'error',
    category: 'Skills',
    description: 'SKILL.md has wrong casing (must be exactly SKILL.md)',
  },
  {
    id: 'SKL002',
    severity: 'warning',
    category: 'Skills',
    description: 'Missing name field in frontmatter',
  },
  {
    id: 'SKL003',
    severity: 'error',
    category: 'Skills',
    description: 'Missing description field (required)',
  },
  {
    id: 'SKL004',
    severity: 'error',
    category: 'Skills',
    description: 'Skill name does not match directory name',
  },
  {
    id: 'SKL005',
    severity: 'error',
    category: 'Skills',
    description: 'Skill name is not valid kebab-case',
  },
  {
    id: 'SKL006',
    severity: 'error',
    category: 'Skills',
    description: 'Skill name exceeds 64 characters',
  },
  {
    id: 'SKL007',
    severity: 'error',
    category: 'Skills',
    description: 'Skill description exceeds 1,024 characters',
  },
  {
    id: 'SKL008',
    severity: 'error',
    category: 'Skills',
    description: 'XML angle brackets in name or description',
  },
  {
    id: 'SKL009',
    severity: 'error',
    category: 'Skills',
    description: 'Skill name contains reserved words (claude, anthropic)',
  },
  {
    id: 'SKL012',
    severity: 'warning',
    category: 'Skills',
    description: 'Skill body exceeds 500 lines',
  },
  {
    id: 'SKL_AGG',
    severity: 'warning',
    category: 'Skills',
    description: 'Aggregate skill descriptions exceed 16,000 characters',
  },
  // ─── Cross-cutting checks ───────────────────────────────────────────────────
  {
    id: 'XCT001',
    severity: 'warning',
    category: 'Cross-cutting',
    description: 'Total token estimate is very large',
  },
  {
    id: 'XCT002',
    severity: 'error',
    category: 'Cross-cutting',
    description: 'Estimated tokens from CLAUDE.md exceed 5,000',
  },
  {
    id: 'XCT003',
    severity: 'warning',
    category: 'Cross-cutting',
    description: 'No .claude/ directory found',
  },
  // ─── Session health ─────────────────────────────────────────────────────────
  {
    id: 'SES001',
    severity: 'warning',
    category: 'Sessions',
    description: 'Session cost exceeds $25.00 (context saturation risk)',
  },
  {
    id: 'SES002',
    severity: 'warning',
    category: 'Sessions',
    description: 'Session had 5+ compaction cycles',
  },
  {
    id: 'SES003',
    severity: 'warning',
    category: 'Sessions',
    description: 'Session consumed more than 2M tokens',
  },
  {
    id: 'SES004',
    severity: 'info',
    category: 'Sessions',
    description: 'Session is stale (14+ days with 10+ messages)',
  },
  {
    id: 'SES005',
    severity: 'warning',
    category: 'Sessions',
    description: 'Session has error patterns (rate limit, auth, proxy)',
  },
  {
    id: 'SES006',
    severity: 'warning',
    category: 'Sessions',
    description: 'Idle/zombie session (75+ min gap without /clear)',
  },
  // ─── Config health ──────────────────────────────────────────────────────────
  {
    id: 'CFG001',
    severity: 'warning',
    category: 'Config',
    description: 'sandbox.enabled=true but no dependency lock files found',
  },
  {
    id: 'CFG002',
    severity: 'warning',
    category: 'Config',
    description: 'allowRead and denyRead have contradictory paths',
  },
  {
    id: 'CFG003',
    severity: 'info',
    category: 'Config',
    description: 'ENABLE_CLAUDEAI_MCP_SERVERS=false (MCP servers disabled)',
  },
  {
    id: 'CFG004',
    severity: 'info',
    category: 'Config',
    description: 'allowedChannelPlugins configured (enterprise plugin control)',
  },
  {
    id: 'CFG005',
    severity: 'warning',
    category: 'Config',
    description: 'Bare mode enabled with hooks/MCPs configured (ignored in bare mode)',
  },
  {
    id: 'CFG006',
    severity: 'warning',
    category: 'Config',
    description: 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB not set (credentials may leak to subprocesses)',
  },
  {
    id: 'CFG007',
    severity: 'info',
    category: 'Config',
    description: 'Skill shell execution enabled with plugins installed',
  },
  // ─── Secret detection ───────────────────────────────────────────────────────
  {
    id: 'SEC001',
    severity: 'error',
    category: 'Secrets',
    description: 'Private key found in session',
  },
  {
    id: 'SEC002',
    severity: 'error',
    category: 'Secrets',
    description: 'AWS access key found in session',
  },
  {
    id: 'SEC003',
    severity: 'warning',
    category: 'Secrets',
    description: 'Authorization header with token found in session',
  },
  {
    id: 'SEC004',
    severity: 'warning',
    category: 'Secrets',
    description: 'API key or access token found in session',
  },
  {
    id: 'SEC005',
    severity: 'warning',
    category: 'Secrets',
    description: 'Password or secret literal found in session',
  },
  {
    id: 'SEC006',
    severity: 'warning',
    category: 'Secrets',
    description: 'Connection string with credentials found in session',
  },
  {
    id: 'SEC007',
    severity: 'warning',
    category: 'Secrets',
    description: 'Platform-specific token found in session',
  },
  {
    id: 'SEC008',
    severity: 'warning',
    category: 'Secrets',
    description: 'Credential leakage risk — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB not set',
  },
]

export const LINT_RULE_MAP = new Map(LINT_RULE_META.map((r) => [r.id, r]))
