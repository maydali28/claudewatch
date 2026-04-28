import * as fs from 'fs'
import * as path from 'path'
import type { LintResult, LintContext } from '@shared/types/lint'
import type { RawSettings } from '@shared/types/config'

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

const LOCK_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Pipfile.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'Cargo.lock',
  'go.sum',
]

// ─── CFG001 — sandbox enabled but no lock files ───────────────────────────────

async function cfg001(
  settings: RawSettings,
  projectRoot: string | undefined
): Promise<LintResult | null> {
  const sandboxEnabled =
    settings.sandbox !== undefined &&
    (settings.sandbox.unsandboxedCommands !== undefined ||
      settings.sandbox.enableWeakerNestedSandbox !== undefined)

  if (!sandboxEnabled) return null
  if (!projectRoot) return null

  for (const lockFile of LOCK_FILES) {
    try {
      await fs.promises.access(path.join(projectRoot, lockFile))
      return null // found a lock file
    } catch {
      // not found, continue
    }
  }

  return {
    id: makeId(),
    checkId: 'CFG001',
    severity: 'warning',
    filePath: path.join(projectRoot, 'settings.json'),
    message: 'sandbox.enabled=true but no dependency lock file found in project root',
    fix: 'Add a lock file (package-lock.json, yarn.lock, etc.) or verify sandbox configuration.',
  }
}

// ─── CFG002 — conflicting allow/deny paths ────────────────────────────────────

function cfg002(settings: RawSettings, settingsPath: string): LintResult | null {
  const allow = settings.permissions?.allow ?? []
  const deny = settings.permissions?.deny ?? []

  for (const allowPath of allow) {
    for (const denyPath of deny) {
      // Check if one is a prefix of the other
      const a = allowPath.endsWith('/') ? allowPath : allowPath + '/'
      const d = denyPath.endsWith('/') ? denyPath : denyPath + '/'
      if (a.startsWith(d) || d.startsWith(a) || allowPath === denyPath) {
        return {
          id: makeId(),
          checkId: 'CFG002',
          severity: 'warning',
          filePath: settingsPath,
          message: `allowRead and denyRead have contradictory paths: "${allowPath}" vs "${denyPath}"`,
          fix: 'Remove the conflicting path from one of the allow/deny lists.',
        }
      }
    }
  }
  return null
}

// ─── CFG003 — MCP servers disabled ───────────────────────────────────────────

function cfg003(settings: RawSettings, settingsPath: string): LintResult | null {
  if (settings.env?.['ENABLE_CLAUDEAI_MCP_SERVERS'] !== 'false') return null
  return {
    id: makeId(),
    checkId: 'CFG003',
    severity: 'info',
    filePath: settingsPath,
    message: 'ENABLE_CLAUDEAI_MCP_SERVERS=false — MCP servers are disabled',
    fix: 'Remove or set ENABLE_CLAUDEAI_MCP_SERVERS=true to re-enable MCP servers.',
  }
}

// ─── CFG004 — allowedChannelPlugins configured ────────────────────────────────

function cfg004(settings: RawSettings, settingsPath: string): LintResult | null {
  const plugins = settings.allowedChannelPlugins ?? []
  if (plugins.length === 0) return null
  return {
    id: makeId(),
    checkId: 'CFG004',
    severity: 'info',
    filePath: settingsPath,
    message: `allowedChannelPlugins configured (${plugins.length} plugin${plugins.length > 1 ? 's' : ''})`,
    fix: 'This is informational — enterprise plugin control is active.',
  }
}

// ─── CFG005 — bare mode with hooks/MCPs ──────────────────────────────────────

function cfg005(settings: RawSettings, settingsPath: string): LintResult | null {
  const isBare = settings.skipDangerousModePermissionPrompt === true
  if (!isBare) return null

  const hasHooks = Object.keys(settings.hooks ?? {}).length > 0
  const hasMcps = Object.keys(settings.mcpServers ?? {}).length > 0

  if (!hasHooks && !hasMcps) return null

  const parts: string[] = []
  if (hasHooks) parts.push('hooks')
  if (hasMcps) parts.push('MCP servers')

  return {
    id: makeId(),
    checkId: 'CFG005',
    severity: 'warning',
    filePath: settingsPath,
    message: `Bare mode enabled with ${parts.join(' and ')} configured (ignored in bare mode)`,
    fix: 'Disable bare mode or remove the hooks/MCPs that will be ignored.',
  }
}

// ─── CFG006 — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB not set ───────────────────────

function cfg006(settings: RawSettings, settingsPath: string): LintResult | null {
  if (settings.env?.['CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'] !== undefined) return null
  return {
    id: makeId(),
    checkId: 'CFG006',
    severity: 'warning',
    filePath: settingsPath,
    message: 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB not set — credentials may leak to subprocesses',
    fix: 'Add CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=true to your env settings.',
  }
}

// ─── CFG007 — skill shell execution enabled with plugins ─────────────────────

function cfg007(settings: RawSettings, settingsPath: string): LintResult | null {
  const shellEnabled = settings.disableSkillShellExecution === false
  const hasPlugins = (settings.plugins ?? []).length > 0
  if (!shellEnabled || !hasPlugins) return null
  return {
    id: makeId(),
    checkId: 'CFG007',
    severity: 'info',
    filePath: settingsPath,
    message: 'Skill shell execution is enabled with plugins installed',
    fix: 'Set disableSkillShellExecution=true if you do not need plugins to run shell commands.',
  }
}

// ─── cfgRules ─────────────────────────────────────────────────────────────────

export async function cfgRules(context: LintContext): Promise<LintResult[]> {
  const results: LintResult[] = []
  const { claudeDir, projectRoot, settings } = context

  if (!settings) return results

  const rawSettings = settings as RawSettings
  const settingsPath = path.join(claudeDir, 'settings.json')

  const r1 = await cfg001(rawSettings, projectRoot)
  if (r1) results.push(r1)

  const r2 = cfg002(rawSettings, settingsPath)
  if (r2) results.push(r2)

  const r3 = cfg003(rawSettings, settingsPath)
  if (r3) results.push(r3)

  const r4 = cfg004(rawSettings, settingsPath)
  if (r4) results.push(r4)

  const r5 = cfg005(rawSettings, settingsPath)
  if (r5) results.push(r5)

  const r6 = cfg006(rawSettings, settingsPath)
  if (r6) results.push(r6)

  const r7 = cfg007(rawSettings, settingsPath)
  if (r7) results.push(r7)

  return results
}
