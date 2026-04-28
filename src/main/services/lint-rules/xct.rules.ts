import * as fs from 'fs'
import type { LintResult, LintContext } from '@shared/types/lint'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

const TOKEN_ESTIMATE_DIVISOR = 4 // chars / 4 ≈ tokens
const XCT001_WARN_TOKENS = 2500
const XCT002_ERROR_TOKENS = 5000

// ─── XCT001 & XCT002 — Token estimate from CLAUDE.md ─────────────────────────

function xct001And002(filePath: string, content: string): LintResult[] {
  const results: LintResult[] = []
  const estimatedTokens = Math.ceil(content.length / TOKEN_ESTIMATE_DIVISOR)

  if (estimatedTokens > XCT002_ERROR_TOKENS) {
    results.push({
      id: makeId(),
      checkId: 'XCT002',
      severity: 'error',
      filePath,
      message: `Estimated token count ~${estimatedTokens.toLocaleString()} exceeds 5,000 token limit`,
      fix: 'Trim CLAUDE.md or move content to .claude/rules/ files (which are loaded on demand).',
    })
    // Also emit XCT001 since it exceeds the warning threshold too
    results.push({
      id: makeId(),
      checkId: 'XCT001',
      severity: 'warning',
      filePath,
      message: `CLAUDE.md is very large (~${estimatedTokens.toLocaleString()} tokens estimated)`,
      fix: 'Consider splitting large sections into .claude/rules/ files.',
    })
  } else if (estimatedTokens > XCT001_WARN_TOKENS) {
    results.push({
      id: makeId(),
      checkId: 'XCT001',
      severity: 'warning',
      filePath,
      message: `CLAUDE.md is large (~${estimatedTokens.toLocaleString()} tokens estimated)`,
      fix: 'Consider splitting large sections into .claude/rules/ files.',
    })
  }

  return results
}

// ─── XCT003 — No .claude/ directory ──────────────────────────────────────────

async function xct003(claudeDir: string): Promise<LintResult | null> {
  try {
    await fs.promises.access(claudeDir)
    return null
  } catch {
    return {
      id: makeId(),
      checkId: 'XCT003',
      severity: 'warning',
      filePath: claudeDir,
      message: 'No .claude/ directory found',
      fix: 'Create a ~/.claude/ directory and add CLAUDE.md with project instructions.',
    }
  }
}

// ─── xctRules ─────────────────────────────────────────────────────────────────

export async function xctRules(context: LintContext): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir, claudeMdPath, claudeMdContent } = context

  const r3 = await xct003(claudeDir)
  if (r3) {
    results.push(r3)
    return results // if no .claude dir, the rest doesn't apply
  }

  if (claudeMdPath && claudeMdContent !== undefined) {
    results.push(...xct001And002(claudeMdPath, claudeMdContent))
  }

  return results
}
