import type { Project, ProjectClaudeMd, UpdateInfo } from '@shared/types/project'
import type { PlanSummary, PlanDetail } from '@shared/types/plan'
import type {
  SessionSummary,
  ParsedSession,
  SessionSearchResult,
  ExportRequest,
} from '@shared/types/session'
import type { AnalyticsData, DateRange, TraySnapshot } from '@shared/types/analytics'
import type {
  ExtendedConfig,
  CommandEntry,
  SkillEntry,
  McpServerEntry,
  MemoryFile,
  PluginEntry,
} from '@shared/types/config'
import type { LintResult, LintSummary } from '@shared/types/lint'
import type { AppPreferences } from '@shared/types/preferences'
import type { ClaudeDirInspection, ClaudeDirSource } from '@shared/types/claude-dir'
import type { SecretFindingRecord, SecretHistoryScanResult } from '@shared/types/secrets'

// ─── Result Wrapper ───────────────────────────────────────────────────────────
// Never throw across IPC — error objects lose type information over serialization.
// Use this discriminated union so callers are forced to handle failures explicitly.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err(error: string, code?: string): Result<never> {
  return { ok: false, error, code }
}

/** Extracts a safe, non-leaking message from an unknown thrown value. */
export function toSafeError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'An unexpected error occurred'
}

// ─── IPC Contract Map ─────────────────────────────────────────────────────────
// Each entry maps a channel to its { request, response } types.
// The preload bridge and renderer client both import this map.

export interface IPCContracts {
  'sessions:list-projects': {
    request: void
    response: Result<{ projects: Project[] }>
  }
  'sessions:get-summary-list': {
    request: { projectId: string }
    response: Result<SessionSummary[]>
  }
  'sessions:get-parsed': {
    request: { sessionId: string; projectId: string }
    response: Result<ParsedSession>
  }
  /** One sub-agent's own transcript, parsed like a session. */
  'sessions:get-subagent': {
    request: { sessionId: string; projectId: string; agentId: string }
    response: Result<ParsedSession>
  }
  'sessions:search': {
    request: { query: string; projectIds?: string[] }
    response: Result<SessionSearchResult[]>
  }
  'sessions:tag': {
    request: { sessionId: string; tags: string[] }
    response: Result<void>
  }
  'secrets:list': {
    request: void
    response: Result<SecretFindingRecord[]>
  }
  'secrets:dismiss': {
    request: { ids: string[] }
    response: Result<void>
  }
  'secrets:scan-history': {
    request: void
    response: Result<SecretHistoryScanResult>
  }
  'sessions:export': {
    request: ExportRequest
    response: Result<string | null> // file path written, or null when the dialog was cancelled
  }
  'analytics:get': {
    request: { dateRange: DateRange; projectIds?: string[] }
    response: Result<AnalyticsData>
  }
  'config:get-full': {
    request: { projectId?: string }
    response: Result<ExtendedConfig>
  }
  'config:get-commands': {
    request: { projectId?: string }
    response: Result<CommandEntry[]>
  }
  'config:get-skills': {
    request: void
    response: Result<SkillEntry[]>
  }
  'config:get-plugins': {
    request: void
    response: Result<PluginEntry[]>
  }
  'config:get-mcps': {
    request: { projectId?: string }
    response: Result<McpServerEntry[]>
  }
  'config:get-memory': {
    request: { projectId?: string }
    response: Result<MemoryFile[]>
  }
  'config:get-project-claude-mds': {
    request: void
    response: Result<ProjectClaudeMd[]>
  }
  'lint:run': {
    request: { projectId?: string }
    response: Result<LintResult[]>
  }
  'lint:get-summary': {
    request: void
    response: Result<LintSummary>
  }
  'settings:get': {
    request: void
    response: Result<AppPreferences>
  }
  'settings:set': {
    request: Partial<AppPreferences>
    response: Result<void>
  }
  'plans:list': {
    request: void
    response: Result<PlanSummary[]>
  }
  'plans:get': {
    request: { id: string }
    response: Result<PlanDetail>
  }
  'updates:check': {
    request: void
    response: Result<UpdateInfo | null>
  }
  'updates:download': {
    request: void
    response: Result<void>
  }
  'updates:install': {
    request: void
    response: Result<void>
  }
  'updates:resize-window': {
    request: { height: number }
    response: Result<void>
  }
  'tray:get-snapshot': {
    request: void
    response: Result<TraySnapshot>
  }
  'tray:open-dashboard': {
    request: { sessionId?: string; projectId?: string }
    response: Result<void>
  }
  'tray:show-about': {
    request: void
    response: Result<void>
  }
  'tray:show-update': {
    request: void
    response: Result<void>
  }
  'tray:show-onboarding': {
    request: { launchAtLogin: boolean }
    response: Result<void>
  }
  'feedback:submit': {
    request: { name: string; email: string; message: string }
    response: Result<void>
  }
  'sentry:capture-exception': {
    request: { message: string; stack?: string; origin: string }
    response: Result<void>
  }
  'app:quit': {
    request: void
    response: Result<void>
  }
  'app:relaunch': {
    request: void
    response: Result<void>
  }
  'app:get-version': {
    request: void
    response: Result<string>
  }
  'app:get-paths': {
    request: void
    response: Result<{
      claudeDir: string
      display: string
      source: ClaudeDirSource
      /** What the folder would be without the app setting: env, settings.json or default. */
      fallback: { claudeDir: string; source: ClaudeDirSource }
    }>
  }
  'app:inspect-claude-dir': {
    request: { path: string }
    response: Result<ClaudeDirInspection>
  }
  /** Opens a folder picker; null when cancelled. */
  'app:choose-claude-dir': {
    request: void
    response: Result<ClaudeDirInspection | null>
  }
  /** Use this folder (null: back to the environment and defaults); windows reload after. */
  'app:set-claude-dir': {
    request: { path: string | null }
    response: Result<void>
  }
}

// Helper types for extracting request/response per channel
export type IPCRequest<C extends keyof IPCContracts> = IPCContracts[C]['request']
export type IPCResponse<C extends keyof IPCContracts> = IPCContracts[C]['response']
