// All IPC channel names — single source of truth used by main handlers and renderer client.
// Pattern: 'domain:action'

export const CHANNELS = {
  // ─── Renderer → Main (ipcMain.handle / ipcRenderer.invoke) ─────────────────

  // Sessions
  SESSIONS_LIST_PROJECTS: 'sessions:list-projects',
  SESSIONS_GET_SUMMARY_LIST: 'sessions:get-summary-list',
  SESSIONS_GET_PARSED: 'sessions:get-parsed',
  SESSIONS_SEARCH: 'sessions:search',
  SESSIONS_TAG: 'sessions:tag',
  SESSIONS_EXPORT: 'sessions:export',

  // Analytics
  ANALYTICS_GET: 'analytics:get',

  // Config
  CONFIG_GET_FULL: 'config:get-full',
  CONFIG_GET_COMMANDS: 'config:get-commands',
  CONFIG_GET_SKILLS: 'config:get-skills',
  CONFIG_GET_PROJECT_SKILLS: 'config:get-project-skills',
  CONFIG_GET_MCPS: 'config:get-mcps',
  CONFIG_GET_MEMORY: 'config:get-memory',
  CONFIG_GET_PROJECT_CLAUDE_MDS: 'config:get-project-claude-mds',

  // Lint
  LINT_RUN: 'lint:run',
  LINT_GET_SUMMARY: 'lint:get-summary',

  // Settings (preferences)
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Plans
  PLANS_LIST: 'plans:list',
  PLANS_GET: 'plans:get',
  PLANS_GET_PROJECTS: 'plans:get-projects',

  // Updates
  UPDATES_CHECK: 'updates:check',
  UPDATES_DOWNLOAD: 'updates:download',
  UPDATES_INSTALL: 'updates:install',
  UPDATES_BREW_UPGRADE: 'updates:brew-upgrade',

  // Tray
  TRAY_OPEN_DASHBOARD: 'tray:open-dashboard',
  TRAY_SHOW_ABOUT: 'tray:show-about',
  TRAY_SHOW_UPDATE: 'tray:show-update',
  TRAY_SHOW_ONBOARDING: 'tray:show-onboarding',

  // Feedback
  FEEDBACK_SUBMIT: 'feedback:submit',

  // Sentry
  SENTRY_CAPTURE_EXCEPTION: 'sentry:capture-exception',

  // App
  APP_QUIT: 'app:quit',
  APP_RELAUNCH: 'app:relaunch',
  APP_GET_VERSION: 'app:get-version',

  // ─── Main → Renderer push events (webContents.send / ipcRenderer.on) ───────

  PUSH_SESSION_UPDATED: 'push:session-updated',
  PUSH_SESSION_CREATED: 'push:session-created',
  PUSH_CONFIG_CHANGED: 'push:config-changed',
  PUSH_SECRETS_DETECTED: 'push:secrets-detected',
  PUSH_UPDATE_AVAILABLE: 'push:update-available',
  PUSH_UPDATE_SERVICE_ERROR: 'push:update-service-error',
  PUSH_TODAY_STATS: 'push:today-stats',
  PUSH_NAVIGATE_SESSION: 'push:navigate-session',
  PUSH_SHOW_UPDATE: 'push:show-update',
  PUSH_SHOW_ONBOARDING: 'push:show-onboarding',
  /**
   * Fired by the SETTINGS_SET handler after preferences are persisted, so that
   * every renderer surface (dashboard, tray popover, onboarding, …) can apply
   * the change without polling or reloading. The payload is the full updated
   * AppPreferences object — renderers replace their local state rather than
   * merging, so any field that was reset upstream is reflected verbatim.
   */
  PUSH_PREFERENCES_CHANGED: 'push:preferences-changed',
  /**
   * Surfaced by the global uncaughtException / unhandledRejection guards in
   * the main process. Renderer shows a non-fatal toast so users notice
   * something went sideways instead of staring at a frozen UI.
   */
  PUSH_MAIN_ERROR: 'push:main-error',
} as const

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS]
export type PushChannel = (typeof CHANNELS)[
  | 'PUSH_SESSION_UPDATED'
  | 'PUSH_SESSION_CREATED'
  | 'PUSH_CONFIG_CHANGED'
  | 'PUSH_SECRETS_DETECTED'
  | 'PUSH_UPDATE_AVAILABLE'
  | 'PUSH_UPDATE_SERVICE_ERROR'
  | 'PUSH_TODAY_STATS'
  | 'PUSH_NAVIGATE_SESSION'
  | 'PUSH_SHOW_UPDATE'
  | 'PUSH_SHOW_ONBOARDING'
  | 'PUSH_PREFERENCES_CHANGED'
  | 'PUSH_MAIN_ERROR']
