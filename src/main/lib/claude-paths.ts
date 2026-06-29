import * as path from 'path'
import * as os from 'os'

/** Absolute path to the user's `~/.claude` directory. */
export function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

/** Absolute path to the `~/.claude/projects` directory. */
export function getProjectsDirPath(): string {
  return path.join(getClaudeDir(), 'projects')
}
