import * as path from 'path'
import { ipcMain } from 'electron'
import { assertSafePath } from '@main/lib/safe-path'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, ExportSchema } from '@shared/ipc/schemas'
import { getClaudeDir } from '@main/lib/claude-paths'
import { parseSessionFull } from '@main/services/session-parser'
import { getActivePricingTable } from '@main/services/pricing-engine'
import { Preferences } from '@main/store/preferences'
import { sessionCache } from '@shared/utils'
import { writeExport } from '@main/services/export-service'

export function registerExportHandlers(): void {
  // ── sessions:export ────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_EXPORT, async (_event, payload) => {
    try {
      const { sessionId, projectId, format, outputPath } = validate(ExportSchema, payload)
      let parsedSession = sessionCache.get(projectId, sessionId)
      if (!parsedSession) {
        const claudeDir = getClaudeDir()
        const projectsDir = path.join(claudeDir, 'projects')
        const sessionFilePath = assertSafePath(projectsDir, projectId, `${sessionId}.jsonl`)
        parsedSession = await parseSessionFull(
          sessionFilePath,
          sessionId,
          projectId,
          getActivePricingTable(Preferences.get())
        )
        sessionCache.set(projectId, sessionId, parsedSession)
      }
      const writtenPath = await writeExport(parsedSession, format, outputPath)
      return ok(writtenPath)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'EXPORT_FAILED')
    }
  })
}
