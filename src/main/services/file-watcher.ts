import * as path from 'path'
import type { FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import { CHANNELS } from '@shared/ipc/channels'
import { sessionCache } from '@shared/utils'
import { parseSessionMetadata } from './session-parser'
import { getPricingTable } from '@shared/constants/pricing'
import { Preferences } from '@main/store/preferences'
import { patchCachedSessionSummary } from '@main/ipc/sessions.handlers'
import { scanFileDelta } from './secret-scanner'
import { createLogger } from '@main/lib/logger'
import {
  FILE_WATCHER_DEBOUNCE_MS,
  FILE_WATCHER_WRITE_FINISH_STABILITY_MS,
  FILE_WATCHER_WRITE_FINISH_POLL_MS,
} from '@shared/constants/tuning'

const log = createLogger('FileWatcher')

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SessionFileLocation {
  projectId: string
  sessionId: string
}

function resolveSessionFileLocation(
  filePath: string,
  projectsDir: string
): SessionFileLocation | null {
  const relativePath = path.relative(projectsDir, filePath)
  const parts = relativePath.split(path.sep)
  if (parts.length !== 2) return null

  return {
    projectId: parts[0],
    sessionId: path.basename(parts[1], '.jsonl'),
  }
}

function buildSecretFingerprint(checkId: string, maskedValue: string): string {
  return `${checkId}:${maskedValue}`
}

function filterNovelFindings<T extends { checkId: string; maskedValue: string }>(
  findings: T[],
  alertedFingerprints: Set<string>
): T[] {
  return findings.filter(
    (finding) =>
      !alertedFingerprints.has(buildSecretFingerprint(finding.checkId, finding.maskedValue))
  )
}

function persistAlertedFingerprints(
  existing: Set<string>,
  novelFindings: Array<{ checkId: string; maskedValue: string }>
): void {
  const updated = [
    ...existing,
    ...novelFindings.map((f) => buildSecretFingerprint(f.checkId, f.maskedValue)),
  ]
  Preferences.set({ alertedSecrets: updated })
}

// ─── FileWatcher ──────────────────────────────────────────────────────────────

export interface FileWatcherDeps {
  /** Fan-out to every renderer surface that displays live session data. */
  broadcast: (channel: string, payload: unknown) => void
  /**
   * Dashboard window getter. Used only for destinations that are legitimately
   * main-window-only (e.g. the secret-detection toast, which is a modal
   * affordance of the dashboard and has no tray equivalent).
   */
  getMainWindow: () => BrowserWindow | null
}

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private settingsWatcher: FSWatcher | null = null
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private claudeDir: string
  private deps: FileWatcherDeps
  // Tracks the byte offset up to which each session file has already been scanned
  // for secrets, so we only ever process genuinely new content.
  private secretScanOffsets: Map<string, number> = new Map()
  // Files currently being parsed — additional change events are skipped until done.
  private pendingParse: Set<string> = new Set()

  constructor(claudeDir: string, deps: FileWatcherDeps) {
    this.claudeDir = claudeDir
    this.deps = deps
  }

  start(): void {
    if (this.watcher) return

    const projectsDir = path.join(this.claudeDir, 'projects')
    const settingsFilePath = path.join(this.claudeDir, 'settings.json')

    // Watch the projects directory itself (not just a glob) so chokidar
    // registers the parent dir and picks up new project subdirs and jsonl
    // files even when the directory is empty at startup.
    //
    // awaitWriteFinish is intentionally left off the watcher and applied
    // only to settings.json (a separate watcher) — JSONL session files are
    // append-only, so partial writes are safe to read: our parser already
    // skips lines that fail JSON.parse, and the byte-offset secret scanner
    // only advances on successful parses. Keeping the 200ms stability
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

    this.settingsWatcher.on('change', (filePath) => this.scheduleProcessing(filePath, false))
    this.settingsWatcher.on('add', (filePath) => this.scheduleProcessing(filePath, true))
    this.settingsWatcher.on('error', (error) => log.error('Settings watcher error:', error))

    this.watcher.on('ready', () => {
      /* watcher initialised */
    })
    this.watcher.on('change', (filePath) => this.scheduleProcessing(filePath, false))
    this.watcher.on('add', (filePath) => this.scheduleProcessing(filePath, true))
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
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  private scheduleProcessing(filePath: string, isNewFile: boolean): void {
    // Skip scheduling if a parse for this file is already in-flight.
    if (this.pendingParse.has(filePath)) return

    const existingTimer = this.debounceTimers.get(filePath)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath)
      this.pendingParse.add(filePath)
      this.processFileChange(filePath, isNewFile)
        .catch((error) => log.error('processFileChange error:', error))
        .finally(() => this.pendingParse.delete(filePath))
    }, FILE_WATCHER_DEBOUNCE_MS)

    this.debounceTimers.set(filePath, timer)
  }

  private async processFileChange(filePath: string, isNewFile: boolean): Promise<void> {
    if (filePath.endsWith('settings.json')) {
      this.deps.broadcast(CHANNELS.PUSH_CONFIG_CHANGED, { filePath })
      return
    }

    if (!filePath.endsWith('.jsonl')) return

    const projectsDir = path.join(this.claudeDir, 'projects')
    const location = resolveSessionFileLocation(filePath, projectsDir)
    if (!location) return

    await this.processSessionFileChange(filePath, location, isNewFile)
  }

  private async processSessionFileChange(
    filePath: string,
    location: SessionFileLocation,
    isNewFile: boolean
  ): Promise<void> {
    const { projectId, sessionId } = location

    try {
      const preferences = Preferences.get()
      const pricingTable = getPricingTable(preferences.pricingProvider, preferences.pricingRegion)
      const sessionSummary = await parseSessionMetadata(
        filePath,
        sessionId,
        projectId,
        pricingTable
      )

      sessionCache.invalidate(sessionId)

      patchCachedSessionSummary(sessionSummary)

      const channel = isNewFile ? CHANNELS.PUSH_SESSION_CREATED : CHANNELS.PUSH_SESSION_UPDATED
      this.deps.broadcast(channel, sessionSummary)

      if (!isNewFile && preferences.secretScanEnabled) {
        this.scanSessionFileForSecrets(filePath, sessionId, projectId).catch(() => undefined)
      }
    } catch (error) {
      log.error('Failed to re-parse session:', sessionId, error)
    }
  }

  private async scanSessionFileForSecrets(
    filePath: string,
    sessionId: string,
    projectId: string
  ): Promise<void> {
    // Secret-detection toast is a modal affordance of the dashboard — the tray
    // popover has no UI for it, so this one stays scoped to the main window.
    const browserWindow = this.deps.getMainWindow()
    if (!browserWindow) return

    const fromOffset = this.secretScanOffsets.get(filePath) ?? 0
    const { findings, newOffset } = await scanFileDelta(filePath, fromOffset)
    this.secretScanOffsets.set(filePath, newOffset)

    if (findings.length === 0) return

    const preferences = Preferences.get()
    const alertedFingerprints = new Set(preferences.alertedSecrets)
    const novelFindings = filterNovelFindings(findings, alertedFingerprints)

    if (novelFindings.length === 0) return

    persistAlertedFingerprints(alertedFingerprints, novelFindings)

    browserWindow.webContents.send(CHANNELS.PUSH_SECRETS_DETECTED, {
      sessionId,
      projectId,
      findings: novelFindings.map((finding) => ({
        checkId: finding.checkId,
        severity: finding.severity,
        patternName: finding.patternName,
        maskedValue: finding.maskedValue,
        lineNumber: finding.lineNumber,
      })),
    })
  }
}
