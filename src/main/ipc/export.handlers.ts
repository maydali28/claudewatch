import * as os from 'os'
import * as path from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { assertSafePath } from '@main/lib/safe-path'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, ExportSchema } from '@shared/ipc/schemas'
import { getProjectsDirPath } from '@main/lib/claude-paths'
import { parseSessionFull } from '@main/services/session-parser'
import { getActivePricingTable } from '@main/services/pricing-engine'
import { Preferences } from '@main/store/preferences'
import { sessionCache } from '@shared/utils'
import { exportFileName, writeExport } from '@main/services/export-service'
import { redactParsedSession } from '@main/services/redact-session'
import type { ExportFormat } from '@shared/types'

const FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  markdown: { name: 'Markdown', extensions: ['md'] },
  json: { name: 'JSON', extensions: ['json'] },
  csv: { name: 'CSV', extensions: ['csv'] },
}

export function registerExportHandlers(): void {
  // ── sessions:export ────────────────────────────────────────────────────────
  // Main asks where to save, so the renderer can never name a path to write.
  ipcMain.handle(CHANNELS.SESSIONS_EXPORT, async (event, payload) => {
    try {
      const { sessionId, projectId, format } = validate(ExportSchema, payload)
      let parsedSession = sessionCache.get(projectId, sessionId)
      if (!parsedSession) {
        const projectsDir = getProjectsDirPath()
        const sessionFilePath = assertSafePath(projectsDir, projectId, `${sessionId}.jsonl`)
        parsedSession = await parseSessionFull(
          sessionFilePath,
          sessionId,
          projectId,
          getActivePricingTable(Preferences.get())
        )
        sessionCache.set(projectId, sessionId, parsedSession)
      }

      const options: Electron.SaveDialogOptions = {
        title: 'Export session',
        defaultPath: path.join(os.homedir(), 'Downloads', exportFileName(parsedSession, format)),
        filters: [FILTERS[format]],
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const choice = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return ok(null)

      // An export leaves the app, so it follows the same redaction setting as the viewer.
      const redacted = redactParsedSession(parsedSession, Preferences.get().redactionLevel)
      const writtenPath = await writeExport(redacted, format, choice.filePath)
      return ok(writtenPath)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'EXPORT_FAILED')
    }
  })
}
