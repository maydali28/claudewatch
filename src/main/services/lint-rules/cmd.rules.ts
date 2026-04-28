import * as fs from 'fs'
import * as path from 'path'
import type { LintResult, LintContext } from '@shared/types/lint'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

// ─── CMD001 — CLAUDE.md exceeds 200 lines ─────────────────────────────────────

function cmd001(filePath: string, lines: string[]): LintResult | null {
  if (lines.length <= 200) return null
  return {
    id: makeId(),
    checkId: 'CMD001',
    severity: 'warning',
    filePath,
    message: `CLAUDE.md has ${lines.length} lines (>200 — dilutes instruction priority)`,
    fix: 'Move large sections into .claude/rules/*.md files and @import them.',
  }
}

// ─── CMD002 — Over 100 lines without a rules directory ────────────────────────

async function cmd002(
  filePath: string,
  lines: string[],
  claudeDir: string
): Promise<LintResult | null> {
  if (lines.length <= 100) return null
  const rulesDir = path.join(claudeDir, 'rules')
  if (await fileExists(rulesDir)) return null
  return {
    id: makeId(),
    checkId: 'CMD002',
    severity: 'info',
    filePath,
    message: `CLAUDE.md has ${lines.length} lines without a .claude/rules/ directory`,
    fix: 'Create .claude/rules/ and split CLAUDE.md into focused rule files.',
  }
}

// ─── CMD003 — ≥3 file-type glob patterns ─────────────────────────────────────

function cmd003(filePath: string, content: string): LintResult | null {
  const matches = content.match(/\*\.\w+/g) ?? []
  if (matches.length < 3) return null
  return {
    id: makeId(),
    checkId: 'CMD003',
    severity: 'warning',
    filePath,
    message: `${matches.length} file-type patterns (*.ext) found — consider scoped rules`,
    fix: 'Move per-filetype rules into individual .claude/rules/*.md files.',
  }
}

// ─── CMD006 — Unclosed code fence ─────────────────────────────────────────────

function cmd006(filePath: string, lines: string[]): LintResult | null {
  let fenceCount = 0
  let lastFenceLine = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      fenceCount++
      lastFenceLine = i + 1
    }
  }
  if (fenceCount % 2 === 0) return null
  return {
    id: makeId(),
    checkId: 'CMD006',
    severity: 'error',
    filePath,
    line: lastFenceLine,
    message: `Unclosed code block — odd number of \`\`\` fences (${fenceCount})`,
    fix: 'Close every code block with a matching ``` fence.',
  }
}

// ─── CMD_IMPORT — @import chain depth > 5 ────────────────────────────────────

async function resolveImportDepth(
  filePath: string,
  claudeDir: string,
  visited: Set<string>,
  depth: number
): Promise<number> {
  if (depth > 10) return depth // hard stop
  if (visited.has(filePath)) return depth
  visited.add(filePath)

  let content: string
  try {
    content = await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return depth
  }

  const importRegex = /^@import\s+(.+)$/gm
  let max = depth
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1].trim()
    const resolved = path.isAbsolute(importPath)
      ? importPath
      : path.resolve(path.dirname(filePath), importPath)
    const childDepth = await resolveImportDepth(resolved, claudeDir, visited, depth + 1)
    if (childDepth > max) max = childDepth
  }
  return max
}

async function cmdImport(filePath: string, claudeDir: string): Promise<LintResult | null> {
  const maxDepth = await resolveImportDepth(filePath, claudeDir, new Set(), 0)
  if (maxDepth <= 5) return null
  return {
    id: makeId(),
    checkId: 'CMD_IMPORT',
    severity: 'warning',
    filePath,
    message: `@import chain depth is ${maxDepth} (>5 hops)`,
    fix: 'Flatten the import chain to at most 5 levels deep.',
  }
}

// ─── CMD_DEPRECATE — .claude/commands/ directory exists ───────────────────────

async function cmdDeprecate(claudeDir: string): Promise<LintResult | null> {
  const commandsDir = path.join(claudeDir, 'commands')
  if (!(await fileExists(commandsDir))) return null
  return {
    id: makeId(),
    checkId: 'CMD_DEPRECATE',
    severity: 'warning',
    filePath: commandsDir,
    message: '.claude/commands/ directory exists (deprecated — use skills instead)',
    fix: 'Migrate commands to .claude/skills/ as SKILL.md files.',
  }
}

// ─── cmdRules ─────────────────────────────────────────────────────────────────

export async function cmdRules(context: LintContext): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir, claudeMdPath, claudeMdContent } = context

  if (claudeMdPath && claudeMdContent !== undefined) {
    const lines = claudeMdContent.split('\n')

    const r1 = cmd001(claudeMdPath, lines)
    if (r1) results.push(r1)

    const r2 = await cmd002(claudeMdPath, lines, claudeDir)
    if (r2) results.push(r2)

    const r3 = cmd003(claudeMdPath, claudeMdContent)
    if (r3) results.push(r3)

    const r6 = cmd006(claudeMdPath, lines)
    if (r6) results.push(r6)

    const rImport = await cmdImport(claudeMdPath, claudeDir)
    if (rImport) results.push(rImport)
  }

  const rDeprecate = await cmdDeprecate(claudeDir)
  if (rDeprecate) results.push(rDeprecate)

  return results
}
