import * as fs from 'fs'
import * as path from 'path'
import type { LintResult, LintContext } from '@shared/types/lint'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

// ─── RUL001 — Malformed YAML frontmatter ─────────────────────────────────────

function rul001(filePath: string, content: string): LintResult | null {
  const hasOpen = content.startsWith('---')
  if (!hasOpen) return null

  // Find closing ---
  const afterOpen = content.slice(3)
  const hasClose = /\r?\n---(\r?\n|$)/.test(afterOpen)
  if (hasClose) return null

  return {
    id: Math.random().toString(36).slice(2),
    checkId: 'RUL001',
    severity: 'error',
    filePath,
    line: 1,
    message: 'Malformed YAML frontmatter — opening --- found but no closing ---',
    fix: 'Add a closing --- line to complete the frontmatter block.',
  }
}

// ─── RUL002 — Invalid glob syntax ────────────────────────────────────────────

function validateGlob(pattern: string): string | null {
  // Check for unmatched [
  let depth = 0
  for (const ch of pattern) {
    if (ch === '[') depth++
    else if (ch === ']') depth--
    if (depth < 0) return 'unmatched ]'
  }
  if (depth > 0) return 'unmatched ['

  // Check for unmatched {
  depth = 0
  for (const ch of pattern) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (depth < 0) return 'unmatched }'
  }
  if (depth > 0) return 'unmatched {'

  // Empty pattern
  if (pattern.trim() === '') return 'empty pattern'
  if (pattern.trim() === '*') return null // valid wildcard

  return null
}

function rul002(filePath: string, content: string): LintResult[] {
  const results: LintResult[] = []
  // Look for glob-like patterns in the content (lines with * patterns)
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match glob patterns: strings containing * or ? with path separators
    const globMatches = line.matchAll(/`([^`]*[*?[{][^`]*)`/g)
    for (const m of globMatches) {
      const pattern = m[1]
      const err = validateGlob(pattern)
      if (err) {
        results.push({
          id: makeId(),
          checkId: 'RUL002',
          severity: 'error',
          filePath,
          line: i + 1,
          message: `Invalid glob syntax in pattern "${pattern}": ${err}`,
          fix: 'Fix the glob pattern syntax.',
          contextLines: [line],
        })
      }
    }
  }
  return results
}

// ─── RUL003 — Glob matches no files ──────────────────────────────────────────

async function rul003(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<LintResult[]> {
  const results: LintResult[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const globMatches = line.matchAll(/`([^`]*[*?][^`]*)`/g)

    for (const m of globMatches) {
      const pattern = m[1]
      if (validateGlob(pattern) !== null) continue // skip invalid globs

      try {
        const { glob } = await import('fs')
        const found = await new Promise<string[]>((resolve, reject) => {
          const _entries: string[] = []
          // Use Node.js glob (v22+) or fallback
          if (typeof (fs as { glob?: unknown }).glob === 'function') {
            const g = glob(pattern, { cwd: projectRoot })
            g.then(resolve).catch(reject)
          } else {
            resolve([]) // skip if glob not available
          }
        })

        if (found.length === 0) {
          results.push({
            id: makeId(),
            checkId: 'RUL003',
            severity: 'info',
            filePath,
            line: i + 1,
            message: `Glob pattern "${pattern}" matches no files in project`,
            fix: 'Verify the pattern is correct relative to the project root.',
            contextLines: [line],
          })
        }
      } catch {
        // Skip if glob fails
      }
    }
  }

  return results
}

// ─── RUL005 — Rule file > 100 lines ──────────────────────────────────────────

function rul005(filePath: string, lines: string[]): LintResult | null {
  if (lines.length <= 100) return null
  return {
    id: makeId(),
    checkId: 'RUL005',
    severity: 'warning',
    filePath,
    message: `Rule file has ${lines.length} lines (>100)`,
    fix: 'Split into multiple focused rule files.',
  }
}

// ─── rulRules ─────────────────────────────────────────────────────────────────

export async function rulRules(context: LintContext): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir, projectRoot } = context

  const rulesDir = context.rulesDir ?? path.join(claudeDir, 'rules')

  let ruleFiles: string[] = []
  try {
    const entries = await fs.promises.readdir(rulesDir, { withFileTypes: true })
    ruleFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => path.join(rulesDir, e.name))
  } catch {
    return [] // no rules directory
  }

  for (const ruleFile of ruleFiles) {
    let content: string
    try {
      content = await fs.promises.readFile(ruleFile, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')

    const r1 = rul001(ruleFile, content)
    if (r1) results.push(r1)

    const r2 = rul002(ruleFile, content)
    results.push(...r2)

    if (projectRoot) {
      const r3 = await rul003(ruleFile, content, projectRoot)
      results.push(...r3)
    }

    const r5 = rul005(ruleFile, lines)
    if (r5) results.push(r5)
  }

  return results
}
