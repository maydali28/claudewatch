import * as path from 'path'
import { ipcMain } from 'electron'
import { assertSafePath } from '@main/lib/safe-path'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, ExportSchema } from '@shared/ipc/schemas'
import { getClaudeDir } from '@main/services/project-scanner'
import { parseSessionFull } from '@main/services/session-parser'
import { sessionCache } from '@shared/utils'
import { writeExport } from '@main/services/export-service'

export function registerExportHandlers(): void {
  // ── sessions:export ────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.SESSIONS_EXPORT, async (_event, payload) => {
    try {
      const { sessionId, projectId, format, outputPath } = validate(ExportSchema, payload)
      let parsedSession = sessionCache.get(sessionId)
      if (!parsedSession) {
        const claudeDir = getClaudeDir()
        const projectsDir = path.join(claudeDir, 'projects')
        const sessionFilePath = assertSafePath(projectsDir, projectId, `${sessionId}.jsonl`)
        parsedSession = await parseSessionFull(sessionFilePath, sessionId, projectId)
        sessionCache.set(sessionId, parsedSession)
      }
      const writtenPath = await writeExport(parsedSession, format, outputPath)
      return ok(writtenPath)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'EXPORT_FAILED')
    }
  })
}
