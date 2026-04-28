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
  /** true on macOS — update is handled via `brew upgrade --cask claudewatch` */
  isMacBrew: boolean
}
