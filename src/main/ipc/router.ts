import { registerSessionsHandlers } from './sessions.handlers'
import { registerPlansHandlers } from './plans.handlers'
import { registerAnalyticsHandlers } from './analytics.handlers'
import { registerConfigHandlers } from './config.handlers'
import { registerLintHandlers } from './lint.handlers'
import { registerSettingsHandlers } from './settings.handlers'
import { registerUpdateHandlers } from './update.handlers'
import { registerExportHandlers } from './export.handlers'
import { registerAppHandlers } from './app.handlers'
import { registerFeedbackHandlers } from './feedback.handlers'
import { registerSentryHandlers } from './sentry.handlers'

/**
 * Register all ipcMain.handle() handlers.
 * Must be called before any BrowserWindow is created so handlers are ready
 * when the renderer first invokes them.
 */
export function registerAllHandlers(): void {
  registerSessionsHandlers()
  registerAnalyticsHandlers()
  registerConfigHandlers()
  registerLintHandlers()
  registerSettingsHandlers()
  registerUpdateHandlers()
  registerExportHandlers()
  registerPlansHandlers()
  registerAppHandlers()
  registerFeedbackHandlers()
  registerSentryHandlers()
}
