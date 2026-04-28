import * as fs from 'fs'
import * as path from 'path'
import type { LintResult, LintContext } from '@shared/types/lint'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  let body = content

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (fmMatch) {
    const rawMeta = fmMatch[1]
    body = fmMatch[2] ?? ''
    for (const line of rawMeta.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        const val = line
          .slice(colonIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
        if (key) meta[key] = val
      }
    }
  }
  return { meta, body }
}

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

interface SkillCheckContext {
  filePath: string
  dirName: string
  fileName: string
  content: string
  meta: Record<string, string>
  body: string
  lines: string[]
}

// ─── Individual rule checks ───────────────────────────────────────────────────

function skl001(ctx: SkillCheckContext): LintResult | null {
  if (ctx.fileName === 'SKILL.md') return null
  return {
    id: makeId(),
    checkId: 'SKL001',
    severity: 'error',
    filePath: ctx.filePath,
    message: `Skill file is named "${ctx.fileName}" — must be exactly SKILL.md (case-sensitive)`,
    fix: 'Rename the file to SKILL.md.',
  }
}

function skl002(ctx: SkillCheckContext): LintResult | null {
  if (ctx.meta['name']) return null
  return {
    id: makeId(),
    checkId: 'SKL002',
    severity: 'warning',
    filePath: ctx.filePath,
    message: 'Missing name field in frontmatter',
    fix: 'Add "name: your-skill-name" to the YAML frontmatter.',
  }
}

function skl003(ctx: SkillCheckContext): LintResult | null {
  if (ctx.meta['description']) return null
  return {
    id: makeId(),
    checkId: 'SKL003',
    severity: 'error',
    filePath: ctx.filePath,
    message: 'Missing description field in frontmatter (required)',
    fix: 'Add "description: ..." to the YAML frontmatter.',
  }
}

function skl004(ctx: SkillCheckContext): LintResult | null {
  const name = ctx.meta['name']
  if (!name) return null
  if (name === ctx.dirName) return null
  return {
    id: makeId(),
    checkId: 'SKL004',
    severity: 'error',
    filePath: ctx.filePath,
    message: `Skill name "${name}" does not match directory name "${ctx.dirName}"`,
    fix: `Either rename the directory to "${name}" or update the name field to "${ctx.dirName}".`,
  }
}

function skl005(ctx: SkillCheckContext): LintResult | null {
  const name = ctx.meta['name']
  if (!name) return null
  if (KEBAB_CASE_REGEX.test(name)) return null
  return {
    id: makeId(),
    checkId: 'SKL005',
    severity: 'error',
    filePath: ctx.filePath,
    message: `Skill name "${name}" is not valid kebab-case`,
    fix: 'Use lowercase letters, numbers, and hyphens only (e.g. "my-skill-name").',
  }
}

function skl006(ctx: SkillCheckContext): LintResult | null {
  const name = ctx.meta['name']
  if (!name || name.length <= 64) return null
  return {
    id: makeId(),
    checkId: 'SKL006',
    severity: 'error',
    filePath: ctx.filePath,
    message: `Skill name is ${name.length} characters (>64)`,
    fix: 'Shorten the skill name to 64 characters or fewer.',
  }
}

function skl007(ctx: SkillCheckContext): LintResult | null {
  const desc = ctx.meta['description']
  if (!desc || desc.length <= 1024) return null
  return {
    id: makeId(),
    checkId: 'SKL007',
    severity: 'error',
    filePath: ctx.filePath,
    message: `Skill description is ${desc.length} characters (>1024)`,
    fix: 'Shorten the description to 1,024 characters or fewer.',
  }
}

function skl008(ctx: SkillCheckContext): LintResult | null {
  const name = ctx.meta['name'] ?? ''
  const desc = ctx.meta['description'] ?? ''
  if (!name.includes('<') && !name.includes('>') && !desc.includes('<') && !desc.includes('>')) {
    return null
  }
  return {
    id: makeId(),
    checkId: 'SKL008',
    severity: 'error',
    filePath: ctx.filePath,
    message: 'XML angle brackets (< or >) found in name or description',
    fix: 'Remove angle brackets from name and description fields.',
  }
}

function skl009(ctx: SkillCheckContext): LintResult | null {
  const name = (ctx.meta['name'] ?? '').toLowerCase()
  if (!name.includes('claude') && !name.includes('anthropic')) return null
  return {
    id: makeId(),
    checkId: 'SKL009',
    severity: 'error',
    filePath: ctx.filePath,
    message: `Skill name "${ctx.meta['name']}" contains reserved word (claude or anthropic)`,
    fix: 'Choose a different name that does not include "claude" or "anthropic".',
  }
}

function skl012(ctx: SkillCheckContext): LintResult | null {
  const bodyLines = ctx.body.split('\n').length
  if (bodyLines <= 500) return null
  return {
    id: makeId(),
    checkId: 'SKL012',
    severity: 'warning',
    filePath: ctx.filePath,
    message: `Skill body has ${bodyLines} lines (>500)`,
    fix: 'Shorten the skill body to 500 lines or fewer.',
  }
}

// ─── SKL_AGG — aggregate descriptions > 16000 chars ──────────────────────────

function sklAgg(skills: Array<{ filePath: string; description: string }>): LintResult | null {
  const total = skills.reduce((sum, s) => sum + s.description.length, 0)
  if (total <= 16000) return null
  return {
    id: makeId(),
    checkId: 'SKL_AGG',
    severity: 'warning',
    filePath: skills[0]?.filePath ?? '',
    message: `Aggregate skill descriptions total ${total} characters (>16,000)`,
    fix: 'Shorten individual skill descriptions to bring the total under 16,000 characters.',
  }
}

// ─── sklRules ─────────────────────────────────────────────────────────────────

export async function sklRules(context: LintContext): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir } = context
  const skillsDir = path.join(claudeDir, 'skills')

  let skillDirs: string[] = []
  try {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }

  const aggDescriptions: Array<{ filePath: string; description: string }> = []

  for (const dirName of skillDirs) {
    const dirPath = path.join(skillsDir, dirName)

    // Look for SKILL.md (also check wrong-cased files)
    let skillFileName = 'SKILL.md'
    let skillFilePath = path.join(dirPath, skillFileName)
    let fileExists = false

    try {
      const filesInDir = await fs.promises.readdir(dirPath)
      const found = filesInDir.find((f) => f.toLowerCase() === 'skill.md')
      if (found) {
        skillFileName = found
        skillFilePath = path.join(dirPath, found)
        fileExists = true
      }
    } catch {
      continue
    }

    if (!fileExists) continue

    let content: string
    try {
      content = await fs.promises.readFile(skillFilePath, 'utf-8')
    } catch {
      continue
    }

    const { meta, body } = parseFrontmatter(content)
    const lines = content.split('\n')

    const ctx: SkillCheckContext = {
      filePath: skillFilePath,
      dirName,
      fileName: skillFileName,
      content,
      meta,
      body,
      lines,
    }

    const checks = [skl001, skl002, skl003, skl004, skl005, skl006, skl007, skl008, skl009, skl012]
    for (const check of checks) {
      const r = check(ctx)
      if (r) results.push(r)
    }

    aggDescriptions.push({ filePath: skillFilePath, description: meta['description'] ?? '' })
  }

  const aggResult = sklAgg(aggDescriptions)
  if (aggResult) results.push(aggResult)

  return results
}
