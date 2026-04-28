import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, AnalyticsGetSchema } from '@shared/ipc/schemas'
import { Preferences } from '@main/store/preferences'
import { computeAnalytics } from '@main/services/analytics-engine'
import { getActivePricingTable } from '@main/services/pricing-engine'
import { getOrScanProjects } from './sessions.handlers'

export function registerAnalyticsHandlers(): void {
  // ── analytics:get ──────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.ANALYTICS_GET, async (_event, payload) => {
    try {
      const { dateRange, projectIds } = validate(AnalyticsGetSchema, payload)
      const prefs = Preferences.get()
      const pricingTable = getActivePricingTable(prefs)

      // Reuse the cached scan result from sessions handlers to avoid redundant full project scans
      const projects = await getOrScanProjects()

      const filteredProjects = projectIds?.length
        ? projects.filter((project) => projectIds.includes(project.id))
        : projects

      const sessions = filteredProjects.flatMap((project) => project.sessions)

      const analytics = computeAnalytics(sessions, filteredProjects, dateRange, pricingTable)
      return ok(analytics)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'ANALYTICS_FAILED')
    }
  })
}
