// ─── Project ──────────────────────────────────────────────────────────────────

import type { SessionSummary } from './session'
import type { SkillEntry } from './config'

export interface ProjectSkillEntry extends SkillEntry {
  projectId: string
  projectName: string
  projectPath: string
}

export interface ProjectClaudeMd {
  projectId: string
  projectName: string
  projectPath: string
  filePath: string
  content: string
  sizeBytes: number
}

export interface Project {
  id: string // URL-encoded directory name (used as key)
  name: string // Human-readable decoded path
  path: string // Full filesystem path
  /** True when `path` came from a transcript `cwd`; false when it is only the lossy decoded directory name. */
  pathResolved: boolean
  sessions: SessionSummary[] // All sessions belonging to this project
  sessionCount: number
  localSkills: SkillEntry[]
  localClaudeMd: string | null
}

// ─── Update Info ──────────────────────────────────────────────────────────────

export interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing'

export interface UpdateServiceError {
  /** Which operation failed. 'install' includes a cancelled macOS password prompt. */
  phase: 'check' | 'download' | 'install'
  message: string
  /** Set on macOS when the app bundle is not writable by the current user. */
  hint?: string
}
