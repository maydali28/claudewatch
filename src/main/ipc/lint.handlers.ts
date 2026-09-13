import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, LintRunSchema } from '@shared/ipc/schemas'
import type { LintResult } from '@shared/types/lint'
import { getOrScanProjects } from './sessions.handlers'
import { runAll, computeLintSummary } from '@main/services/lint-service'

// Cache last lint results so get-summary can read them without re-running
let lastLintResults: LintResult[] = []

export function registerLintHandlers(): void {
  ipcMain.handle(CHANNELS.LINT_RUN, async (_event, payload) => {
    try {
      const lintRunRequest = validate(LintRunSchema, payload)
      // Reuse the shared scan rather than starting a second full one. Parsing
      // now happens in the accounting worker, so main has no scanner of its own.
      const projects = await getOrScanProjects()
      const allSessions = projects.flatMap((project) => project.sessions)

      const lintResults = await runAll(allSessions, lintRunRequest?.projectId)
      lastLintResults = lintResults
      return ok(lintResults)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'LINT_RUN_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.LINT_GET_SUMMARY, async () => {
    try {
      const summary = computeLintSummary(lastLintResults)
      return ok(summary)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'LINT_SUMMARY_FAILED')
    }
  })
}
