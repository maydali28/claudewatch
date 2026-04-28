import { ipcRenderer } from 'electron'
import type { IPCContracts, IPCRequest, IPCResponse } from '@shared/ipc/contracts'
import { CHANNELS, type PushChannel } from '@shared/ipc/channels'

// ─── Typed invoke helper ──────────────────────────────────────────────────────

function invoke<C extends keyof IPCContracts>(
  channel: C,
  request?: IPCRequest<C>
): Promise<IPCResponse<C>> {
  return ipcRenderer.invoke(channel as string, request) as Promise<IPCResponse<C>>
}

// ─── ClaudeWatchAPI ───────────────────────────────────────────────────────────
// This object is exposed on window.claudewatch via contextBridge.
// All methods are async and return Result<T> — never throw.

export const api = {
  // ─── Sessions ───────────────────────────────────────────────────────────────
  sessions: {
    listProjects: () => invoke(CHANNELS.SESSIONS_LIST_PROJECTS),

    getSummaryList: (projectId: string) =>
      invoke(CHANNELS.SESSIONS_GET_SUMMARY_LIST, { projectId }),

    getParsed: (sessionId: string, projectId: string) =>
      invoke(CHANNELS.SESSIONS_GET_PARSED, { sessionId, projectId }),

    search: (query: string, projectIds?: string[]) =>
      invoke(CHANNELS.SESSIONS_SEARCH, { query, projectIds }),

    tag: (sessionId: string, tags: string[]) => invoke(CHANNELS.SESSIONS_TAG, { sessionId, tags }),

    export: (request: IPCRequest<typeof CHANNELS.SESSIONS_EXPORT>) =>
      invoke(CHANNELS.SESSIONS_EXPORT, request),
  },

  // ─── Analytics ──────────────────────────────────────────────────────────────
  analytics: {
    get: (request: IPCRequest<typeof CHANNELS.ANALYTICS_GET>) =>
      invoke(CHANNELS.ANALYTICS_GET, request),
  },

  // ─── Config ─────────────────────────────────────────────────────────────────
  config: {
    getFull: (projectId?: string) => invoke(CHANNELS.CONFIG_GET_FULL, { projectId }),

    getCommands: (projectId?: string) => invoke(CHANNELS.CONFIG_GET_COMMANDS, { projectId }),

    getSkills: () => invoke(CHANNELS.CONFIG_GET_SKILLS),

    getProjectSkills: () => invoke(CHANNELS.CONFIG_GET_PROJECT_SKILLS),

    getMcps: (projectId?: string) => invoke(CHANNELS.CONFIG_GET_MCPS, { projectId }),

    getMemory: (projectId?: string) => invoke(CHANNELS.CONFIG_GET_MEMORY, { projectId }),

    getProjectClaudeMds: () => invoke(CHANNELS.CONFIG_GET_PROJECT_CLAUDE_MDS),
  },

  // ─── Lint ────────────────────────────────────────────────────────────────────
  lint: {
    run: (projectId?: string) => invoke(CHANNELS.LINT_RUN, { projectId }),

    getSummary: () => invoke(CHANNELS.LINT_GET_SUMMARY),
  },

  // ─── Settings ────────────────────────────────────────────────────────────────
  settings: {
    get: () => invoke(CHANNELS.SETTINGS_GET),

    set: (patch: IPCRequest<typeof CHANNELS.SETTINGS_SET>) => invoke(CHANNELS.SETTINGS_SET, patch),
  },

  // ─── Plans ───────────────────────────────────────────────────────────────────
  plans: {
    list: () => invoke(CHANNELS.PLANS_LIST),

    get: (filename: string) => invoke(CHANNELS.PLANS_GET, { filename }),

    getProjects: (slug: string) => invoke(CHANNELS.PLANS_GET_PROJECTS, { slug }),
  },

  // ─── Updates ─────────────────────────────────────────────────────────────────
  updates: {
    check: () => invoke(CHANNELS.UPDATES_CHECK),

    download: () => invoke(CHANNELS.UPDATES_DOWNLOAD),

    install: () => invoke(CHANNELS.UPDATES_INSTALL),

    brewUpgrade: () => invoke(CHANNELS.UPDATES_BREW_UPGRADE),
  },

  // ─── Tray ─────────────────────────────────────────────────────────────────
  tray: {
    openDashboard: (sessionId?: string, projectId?: string) =>
      invoke(CHANNELS.TRAY_OPEN_DASHBOARD, { sessionId, projectId }),
    showAbout: () => invoke(CHANNELS.TRAY_SHOW_ABOUT),
    showUpdate: () => invoke(CHANNELS.TRAY_SHOW_UPDATE),
    showOnboarding: (launchAtLogin: boolean) =>
      invoke(CHANNELS.TRAY_SHOW_ONBOARDING, { launchAtLogin }),
  },

  // ─── Feedback ─────────────────────────────────────────────────────────────
  feedback: {
    submit: (name: string, email: string, message: string) =>
      invoke(CHANNELS.FEEDBACK_SUBMIT, { name, email, message }),
  },

  // ─── Sentry ───────────────────────────────────────────────────────────────
  sentry: {
    captureException: (message: string, stack: string | undefined, origin: string) =>
      invoke(CHANNELS.SENTRY_CAPTURE_EXCEPTION, { message, stack, origin }),
  },

  // ─── App ──────────────────────────────────────────────────────────────────
  app: {
    quit: () => invoke(CHANNELS.APP_QUIT),
    relaunch: () => invoke(CHANNELS.APP_RELAUNCH),
    getVersion: () => invoke(CHANNELS.APP_GET_VERSION),
  },

  // ─── Push event subscriptions ─────────────────────────────────────────────
  // Returns an unsubscribe function so React effects can clean up properly.
  on: <T = unknown>(channel: PushChannel, handler: (data: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: T) => handler(data)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
}

export type ClaudeWatchAPI = typeof api
