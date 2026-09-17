import * as fs from 'fs'
import * as path from 'path'
import type { FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import { CHANNELS } from '@shared/ipc/channels'
import { sessionCache } from '@shared/utils'
import { getActivePricingTable } from './pricing-engine'
import { accountingWorker } from './accounting/worker-client'
import { Preferences } from '@main/store/preferences'
import {
  patchCachedSessionSummary,
  removeCachedSession,
  peekCachedSessionsForProject,
} from '@main/ipc/sessions.handlers'
import { invalidateCachedSummary } from './metadata-cache'
import { createLogger } from '@main/lib/logger'
import { resolveSessionFileLocation, type SessionFileLocation } from './session-file-location'
import { ReparseScheduler } from './reparse-scheduler'
import {
  FILE_WATCHER_DEBOUNCE_MS,
  FILE_WATCHER_WRITE_FINISH_STABILITY_MS,
  FILE_WATCHER_WRITE_FINISH_POLL_MS,
} from '@shared/constants/tuning'

const log = createLogger('FileWatcher')

// ─── FileWatcher ──────────────────────────────────────────────────────────────

export interface FileWatcherDeps {
  /** Fan-out to every renderer surface that displays live session data. */
  broadcast: (channel: string, payload: unknown) => void
  /**
   * Dashboard window getter, reserved for a future main-window-only push
   * destination. Not currently read by FileWatcher itself — kept on the
   * deps contract rather than threaded back through main/index.ts on and
   * off as that need comes and goes.
   */
  getMainWindow: () => BrowserWindow | null
}

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private settingsWatcher: FSWatcher | null = null
  private scheduler: ReparseScheduler
  /**
   * Paths first seen via an `add` event. Held here rather than passed through
   * the scheduler because a burst can mix an add with later changes, and the
   * session is still new the first time we actually parse it.
   */
  private newFiles: Set<string> = new Set()
  private claudeDir: string
  /** Derived once from `claudeDir` at construction — the one place this join happens. */
  private projectsDir: string
  private deps: FileWatcherDeps
  constructor(claudeDir: string, deps: FileWatcherDeps) {
    this.claudeDir = claudeDir
    this.projectsDir = path.join(claudeDir, 'projects')
    this.deps = deps
    this.scheduler = new ReparseScheduler(
      (parentKey) => this.processFileChange(parentKey),
      FILE_WATCHER_DEBOUNCE_MS,
      (parentKey, error) => log.error(`Failed to re-parse ${path.basename(parentKey)}:`, error)
    )
  }

  start(): void {
    if (this.watcher) return

    const projectsDir = this.projectsDir
    const settingsFilePath = path.join(this.claudeDir, 'settings.json')

    // Watch the projects directory itself (not just a glob) so chokidar
    // registers the parent dir and picks up new project subdirs and jsonl
    // files even when the directory is empty at startup.
    //
    // awaitWriteFinish is intentionally left off the watcher and applied
    // only to settings.json (a separate watcher) — JSONL session files are
    // append-only, so partial writes are safe to read: our parser already
    // skips lines that fail JSON.parse. Keeping the 200ms stability
    // threshold here was perceptible to users when streaming a fresh turn.
    this.watcher = chokidar.watch(projectsDir, {
      persistent: true,
      ignoreInitial: true,
    })

    this.settingsWatcher = chokidar.watch(settingsFilePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: FILE_WATCHER_WRITE_FINISH_STABILITY_MS,
        pollInterval: FILE_WATCHER_WRITE_FINISH_POLL_MS,
      },
    })

    this.settingsWatcher.on('change', (filePath) => this.scheduler.schedule(filePath))
    this.settingsWatcher.on('add', (filePath) => this.scheduler.schedule(filePath))
    this.settingsWatcher.on('unlink', (filePath) => this.scheduler.schedule(filePath))
    this.settingsWatcher.on('error', (error) => log.error('Settings watcher error:', error))

    this.watcher.on('ready', () => {
      /* watcher initialised */
    })
    this.watcher.on('change', (filePath) =>
      this.scheduler.schedule(filePath, this.resolveParentKey(filePath))
    )
    this.watcher.on('add', (filePath) => {
      const parentKey = this.resolveParentKey(filePath)
      // Only a genuinely new PARENT transcript counts as a new session — a
      // subagent's first write coalesces onto its parent's key and must not
      // masquerade as one (see the isNewFile guard in processSessionFileChange).
      if (parentKey === filePath) this.newFiles.add(filePath)
      this.scheduler.schedule(filePath, parentKey)
    })
    // A deleted subagent transcript kept contributing its usage to the
    // parent's rollup until something else happened to re-parse the parent;
    // a deleted parent session lingered in memory until the next full
    // discovery. Routing `unlink` through the same scheduler as `change`
    // means `processSessionFileChange` reacts to the settled state (file
    // exists or not) at execution time rather than trusting the event type —
    // which also collapses a delete-then-recreate burst into one correct
    // outcome instead of two conflicting ones.
    this.watcher.on('unlink', (filePath) =>
      this.scheduler.schedule(filePath, this.resolveParentKey(filePath))
    )
    this.watcher.on('unlinkDir', (dirPath) => this.handleUnlinkDir(dirPath))
    this.watcher.on('error', (error) => log.error('Watcher error:', error))
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close().catch((error) => log.error('Close error:', error))
      this.watcher = null
    }
    if (this.settingsWatcher) {
      this.settingsWatcher.close().catch((error) => log.error('Settings close error:', error))
      this.settingsWatcher = null
    }
    this.scheduler.stop()
  }

  /**
   * The identity a change should be coalesced and parsed against. A subagent
   * write updates its parent's rollup, not anything readable on its own, so
   * every child of a session resolves to the same key as the parent
   * transcript itself — required so ReparseScheduler can merge a burst across
   * many children into one parse (see reparse-scheduler.ts). Anything that
   * isn't a recognised session file (settings.json, a stray non-jsonl path)
   * has no parent/child distinction, so it is its own key.
   */
  private resolveParentKey(filePath: string): string {
    if (!filePath.endsWith('.jsonl')) return filePath
    const projectsDir = this.projectsDir
    const location = resolveSessionFileLocation(filePath, projectsDir)
    if (!location || !location.isSubagent) return filePath
    return path.join(projectsDir, location.projectId, `${location.sessionId}.jsonl`)
  }

  private async processFileChange(filePath: string): Promise<void> {
    const isNewFile = this.newFiles.delete(filePath)
    if (filePath.endsWith('settings.json')) {
      this.deps.broadcast(CHANNELS.PUSH_CONFIG_CHANGED, { filePath })
      return
    }

    if (!filePath.endsWith('.jsonl')) return

    const projectsDir = this.projectsDir
    const location = resolveSessionFileLocation(filePath, projectsDir)
    if (!location) return

    // A subagent write updates the parent session; it never creates one.
    await this.processSessionFileChange(filePath, location, isNewFile && !location.isSubagent)
  }

  private async processSessionFileChange(
    filePath: string,
    location: SessionFileLocation,
    isNewFile: boolean
  ): Promise<void> {
    const { projectId, sessionId } = location

    // `filePath` is already the parent's own path here — the scheduler is
    // keyed on parentKey (see resolveParentKey below), so `location.isSubagent`
    // can never be true at this point regardless of which child originally
    // triggered the change. The parent/child branch used to live here; it's
    // gone rather than left as dead code that looks live.
    const parentPath = filePath

    // A deleted SUBAGENT needs nothing beyond the parent re-parse below — the
    // rollup simply stops finding it, which is the correct result. A deleted
    // PARENT has no file left to hand the worker at all: check the settled
    // state of the parent itself (regardless of which path the event named)
    // so a subagent deletion racing an already-gone parent is handled the
    // same way as a direct parent deletion, instead of failing a parse
    // against a path that no longer exists.
    if (!fs.existsSync(parentPath)) {
      this.handleParentRemoved(parentPath, sessionId, projectId)
      return
    }

    try {
      const preferences = Preferences.get()
      // The active table, not the bare provider default: the watcher used to
      // ignore the user's pricing overrides, so a session's cost changed the
      // moment the app restarted and rescanned it.
      const pricingTable = getActivePricingTable(preferences)
      const sessionSummary = await accountingWorker.parseSession(
        parentPath,
        sessionId,
        projectId,
        pricingTable
      )

      sessionCache.invalidate(projectId, sessionId)

      patchCachedSessionSummary(sessionSummary)

      const channel = isNewFile ? CHANNELS.PUSH_SESSION_CREATED : CHANNELS.PUSH_SESSION_UPDATED
      this.deps.broadcast(channel, sessionSummary)

      // Live secret scanning was removed for 1.5.x; it returns with a visible
      // alert and a toggle in roadmap #4.
    } catch (error) {
      log.error('Failed to re-parse session:', sessionId, error)
    }
  }

  /**
   * The parent transcript is gone: there is nothing left to re-parse, so
   * forget every cache that still thinks the session exists rather than
   * let a stale entry survive until the next full discovery, and tell the
   * renderer directly since no further push for this session is coming.
   */
  private handleParentRemoved(parentPath: string, sessionId: string, projectId: string): void {
    invalidateCachedSummary(parentPath)
    sessionCache.invalidate(projectId, sessionId)
    removeCachedSession(projectId, sessionId)
    this.deps.broadcast(CHANNELS.PUSH_SESSION_DELETED, { sessionId, projectId })
  }

  /**
   * A directory disappeared under `projects/`. Two shapes matter:
   *   `<project>/<session>` — the session's own dir, holding only its
   *     subagents/ folder. The parent .jsonl is a sibling file and is
   *     untouched, so re-parsing it is enough — the rollup simply finds no
   *     subagents left.
   *   `<project>` — the whole project vanished. Nothing under it will ever
   *     emit its own unlink event for main to react to individually, so
   *     every session known for it must be torn down here.
   */
  private handleUnlinkDir(dirPath: string): void {
    const projectsDir = this.projectsDir
    const relative = path.relative(projectsDir, dirPath)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return

    const parts = relative.split(path.sep)

    if (parts.length === 2) {
      const [projectId, sessionId] = parts
      const parentPath = path.join(projectsDir, projectId, `${sessionId}.jsonl`)
      this.scheduler.schedule(parentPath)
      return
    }

    if (parts.length === 1) {
      const [projectId] = parts
      for (const session of peekCachedSessionsForProject(projectId)) {
        const parentPath = path.join(projectsDir, projectId, `${session.id}.jsonl`)
        this.handleParentRemoved(parentPath, session.id, projectId)
      }
    }
  }
}
