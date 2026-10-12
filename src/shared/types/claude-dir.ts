/** Where the Claude folder ClaudeWatch reads came from. See `@main/lib/claude-paths`. */
export type ClaudeDirSource = 'app-setting' | 'env' | 'user-settings' | 'default'

/** What a candidate Claude folder holds, checked before it is used. */
export interface ClaudeDirInspection {
  /** The folder as it would be used: `~` expanded, made absolute. */
  path: string
  exists: boolean
  isDirectory: boolean
  /** Folders under `projects/`, one per project Claude Code worked in. */
  projectCount: number
  /** Transcripts directly under those project folders. */
  sessionCount: number
  hasSettings: boolean
  /** Has `projects/` or `settings.json`: what Claude Code leaves behind. */
  looksLikeClaudeDir: boolean
}
