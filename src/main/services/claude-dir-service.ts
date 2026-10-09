import * as fs from 'fs'
import * as path from 'path'
import type { ClaudeDirInspection } from '@shared/types/claude-dir'
import { expandClaudeDirPath, setClaudeDirOverride, getClaudeDir } from '@main/lib/claude-paths'
import { Preferences } from '@main/store/preferences'

/** Look at a candidate Claude folder without changing anything. */
export async function inspectClaudeDir(input: string): Promise<ClaudeDirInspection> {
  const dir = expandClaudeDirPath(input.trim())
  const empty: ClaudeDirInspection = {
    path: dir,
    exists: false,
    isDirectory: false,
    projectCount: 0,
    sessionCount: 0,
    hasSettings: false,
    looksLikeClaudeDir: false,
  }
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(dir)
  } catch {
    return empty
  }
  if (!stat.isDirectory()) return { ...empty, exists: true }

  let projectCount = 0
  let sessionCount = 0
  let hasProjects = false
  try {
    const projects = await fs.promises.readdir(path.join(dir, 'projects'), { withFileTypes: true })
    hasProjects = true
    for (const p of projects) {
      if (!p.isDirectory()) continue
      projectCount++
      try {
        const files = await fs.promises.readdir(path.join(dir, 'projects', p.name))
        sessionCount += files.filter((f) => f.endsWith('.jsonl')).length
      } catch {
        // Unreadable project folder: count the project, not its sessions.
      }
    }
  } catch {
    // No projects folder yet.
  }
  const hasSettings = fs.existsSync(path.join(dir, 'settings.json'))
  return {
    path: dir,
    exists: true,
    isDirectory: true,
    projectCount,
    sessionCount,
    hasSettings,
    looksLikeClaudeDir: hasProjects || hasSettings,
  }
}

type ClaudeDirChangeHandler = (dir: string) => Promise<void>
let changeHandler: ClaudeDirChangeHandler | null = null

/**
 * Registered by main at startup: re-points everything that captured the
 * folder (watcher, worker, caches, secret scanner) and reloads the windows.
 */
export function onClaudeDirChange(handler: ClaudeDirChangeHandler): void {
  changeHandler = handler
}

/**
 * Use `input` as the Claude folder, or go back to the environment and
 * defaults with `null`. A folder must exist; one that does not look like a
 * Claude folder is still accepted (Claude Code may not have written to it
 * yet), and the Settings page says so before the user applies it.
 */
export async function changeClaudeDir(input: string | null): Promise<void> {
  if (input !== null) {
    const inspection = await inspectClaudeDir(input)
    if (!inspection.isDirectory) {
      throw new Error(
        inspection.exists
          ? `${inspection.path} is not a folder`
          : `${inspection.path} does not exist`
      )
    }
    Preferences.set({ claudeDirOverride: inspection.path })
    setClaudeDirOverride(inspection.path)
  } else {
    Preferences.set({ claudeDirOverride: undefined })
    setClaudeDirOverride(null)
  }
  await changeHandler?.(getClaudeDir())
}
