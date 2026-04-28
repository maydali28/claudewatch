import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import {
  validate,
  GetSummaryListSchema,
  GetParsedSchema,
  SearchSchema,
  TagSchema,
} from '@shared/ipc/schemas'
import type { SessionSummary } from '@shared/types/session'
import { Preferences } from '@main/store/preferences'
import { getProjectsDirPath } from '@main/services/project-scanner'
import { assertSafePath } from '@main/lib/safe-path'
import { parseSessionFull } from '@main/services/session-parser'
import { sessionCache } from '@shared/utils'
import { getActivePricingTable } from '@main/services/pricing-engine'
import { scanCache } from '@main/services/scan-cache'
import { searchSessions } from '@main/services/session-search'
import { createLogger } from '@main/lib/logger'

const log = createLogger('sessions')

/**
 * Re-export so the file watcher can keep using the same import path.
 */
export async function patchCachedSessionSummary(summary: SessionSummary): Promise<void> {
  await scanCache.patchSessionSummary(summary)
}

export async function getOrScanProjects() {
  const scan = await scanCache.get()
  return scan.projects
}

export function registerSessionsHandlers(): void {
  // ── sessions:list-projects ─────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_LIST_PROJECTS, async () => {
    try {
      const result = await scanCache.refresh()
      return ok(result)
    } catch (e) {
      log.error('list-projects error:', e)
      captureHandlerException(e)
      return err(toSafeError(e), 'SCAN_FAILED')
    }
  })

  // ── sessions:get-summary-list ──────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_GET_SUMMARY_LIST, async (_event, payload) => {
    try {
      const { projectId } = validate(GetSummaryListSchema, payload)
      const sessions = await scanCache.getSessionsForProject(projectId)
      return ok(sessions)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'SUMMARY_FAILED')
    }
  })

  // ── sessions:get-parsed ────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_GET_PARSED, async (_event, payload) => {
    try {
      const { sessionId, projectId } = validate(GetParsedSchema, payload)
      // Check LRU cache first
      const cached = sessionCache.get(sessionId)
      if (cached) return ok(cached)

      const projectsDir = getProjectsDirPath()
      const sessionFilePath = assertSafePath(projectsDir, projectId, `${sessionId}.jsonl`)
      const prefs = Preferences.get()
      const pricingTable = getActivePricingTable(prefs)
      const parsedSession = await parseSessionFull(
        sessionFilePath,
        sessionId,
        projectId,
        pricingTable
      )
      sessionCache.set(sessionId, parsedSession)
      return ok(parsedSession)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'PARSE_FAILED')
    }
  })

  // ── sessions:search ────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_SEARCH, async (_event, payload) => {
    try {
      const searchRequest = validate(SearchSchema, payload)
      const results = await searchSessions(searchRequest)
      return ok(results)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'SEARCH_FAILED')
    }
  })

  // ── sessions:tag ──────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_TAG, async (_event, payload) => {
    try {
      const { sessionId, tags } = validate(TagSchema, payload)
      Preferences.setSessionTags(sessionId, tags)
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'TAG_FAILED')
    }
  })

  // sessions:export is handled by export.handlers.ts (registered via router)
}
