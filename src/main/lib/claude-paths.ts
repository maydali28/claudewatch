import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

/**
 * How the effective Claude directory was resolved:
 *  - 'env': `process.env.CLAUDE_CONFIG_DIR` was set when this process started.
 *  - 'user-settings': the default `~/.claude/settings.json`'s `env.CLAUDE_CONFIG_DIR`
 *    key pointed elsewhere. This is the case that matters most on macOS: the
 *    desktop app is launched from Finder/Dock without the shell's environment,
 *    so the process-env branch above almost never fires for a real user, while
 *    Claude Code itself is launched from a shell and does read this file.
 *  - 'default': neither override was present; `~/.claude` is used as-is.
 *
 * Managed settings (the third place Claude Code honours this variable) are
 * out of scope for this task — see 1.6 roadmap item #34/#12.
 */
export type ClaudeDirSource = 'env' | 'user-settings' | 'default'

let cached: { dir: string; source: ClaudeDirSource } | null = null

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  // A relative override is resolved against the home directory, matching how
  // Claude Code treats `CLAUDE_CONFIG_DIR=.claude-work`.
  return path.isAbsolute(p) ? p : path.resolve(os.homedir(), p)
}

function readUserSettingsOverride(defaultDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(defaultDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> }
    const v = parsed.env?.['CLAUDE_CONFIG_DIR']
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

function resolve(): { dir: string; source: ClaudeDirSource } {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (fromEnv) return { dir: expandHome(fromEnv), source: 'env' }

  const defaultDir = path.join(os.homedir(), '.claude')
  const fromSettings = readUserSettingsOverride(defaultDir)
  if (fromSettings) return { dir: expandHome(fromSettings), source: 'user-settings' }

  return { dir: defaultDir, source: 'default' }
}

/** Absolute path to the effective Claude directory (default `~/.claude`). */
export function getClaudeDir(): string {
  return (cached ??= resolve()).dir
}

/** How `getClaudeDir()`'s result was determined. See {@link ClaudeDirSource}. */
export function getClaudeDirSource(): ClaudeDirSource {
  return (cached ??= resolve()).source
}

/** Tests only: forget the cached resolution so the next call re-resolves. */
export function resetClaudeDirCache(): void {
  cached = null
}

/**
 * Sets the cache directly, bypassing `resolve()`.
 *
 * `worker_threads` do not share module state with the main thread — the
 * accounting worker (`src/main/services/accounting/worker-entry.ts`) runs in
 * its own realm of this module and would otherwise resolve the Claude
 * directory independently, which can disagree with what `FileWatcher` is
 * watching on the main thread (e.g. if the user-settings override changes
 * between the main thread's first resolution and a worker respawn). The
 * worker's host calls this once, at startup, with the main thread's already-
 * resolved value passed through `workerData`.
 */
export function seedClaudeDir(dir: string, source: ClaudeDirSource): void {
  cached = { dir, source }
}

/**
 * `~/.claude.json` by default; `<CLAUDE_CONFIG_DIR>/.claude.json` when the
 * directory is overridden. Verified against a real `claude -p` run in a
 * throwaway `CLAUDE_CONFIG_DIR` (Task 6, Step 4): with the override set,
 * Claude Code wrote `.claude.json` and `projects/` inside that directory,
 * not under `$HOME`, so the override case follows the override dir rather
 * than always defaulting to `$HOME/.claude.json`.
 */
export function getClaudeJsonPath(): string {
  return getClaudeDirSource() === 'default'
    ? path.join(os.homedir(), '.claude.json')
    : path.join(getClaudeDir(), '.claude.json')
}

/** Absolute path to the `projects` directory under the effective Claude dir. */
export function getProjectsDirPath(): string {
  return path.join(getClaudeDir(), 'projects')
}

/** Absolute path to `settings.json` under the effective Claude dir. */
export function getUserSettingsPath(): string {
  return path.join(getClaudeDir(), 'settings.json')
}

/** Absolute path to the `plans` directory under the effective Claude dir. */
export function getDefaultPlansDirPath(): string {
  return path.join(getClaudeDir(), 'plans')
}

/** Absolute path to the `commands` directory under the effective Claude dir. */
export function getUserCommandsDirPath(): string {
  return path.join(getClaudeDir(), 'commands')
}

/** Absolute path to the `skills` directory under the effective Claude dir. */
export function getUserSkillsDirPath(): string {
  return path.join(getClaudeDir(), 'skills')
}

/** Absolute path to the `debug/latest` MCP log under the effective Claude dir. */
export function getMcpDebugLatestPath(): string {
  return path.join(getClaudeDir(), 'debug', 'latest')
}

/** For UI copy: "~/.claude" or the override, with the home prefix shortened to "~". */
export function describeClaudeDir(): string {
  const dir = getClaudeDir()
  const home = os.homedir()
  return dir === home || dir.startsWith(home + path.sep) ? '~' + dir.slice(home.length) : dir
}
