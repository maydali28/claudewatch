import type { SessionSummary } from '@shared/types/session'
import type { ScanProjectsResult } from './accounting/worker-protocol'
import { Preferences } from '@main/store/preferences'
import { getActivePricingTable } from './pricing-engine'
import { accountingWorker } from './accounting/worker-client'

type ScanResult = ScanProjectsResult

/**
 * In-memory cache of the last full project scan.
 *
 * Owned by the main process and read by every sessions:* IPC handler. The
 * file watcher patches this cache incrementally via `patchSessionSummary` so
 * the renderer can list sessions without paying for a fresh disk scan on
 * every request.
 */
class ScanCache {
  private current: ScanResult | null = null
  private inFlight: Promise<ScanResult> | null = null

  /**
   * Returns the cached scan, performing a fresh scan if the cache is empty.
   */
  async get(): Promise<ScanResult> {
    if (!this.current) {
      this.current = await this.refresh()
    }
    return this.current
  }

  /**
   * Force a fresh scan and replace the cache.
   */
  async refresh(): Promise<ScanResult> {
    // Share one in-flight scan. Without this, concurrent cold requests — the
    // tray and the dashboard opening together — each start a full scan, and the
    // slower one overwrites the newer result when it finishes.
    if (this.inFlight) return this.inFlight

    const prefs = Preferences.get()
    const pricingTable = getActivePricingTable(prefs)
    this.inFlight = accountingWorker
      .scanProjects(pricingTable)
      .then((result) => {
        this.current = result
        return result
      })
      .finally(() => {
        this.inFlight = null
      })

    return this.inFlight
  }

  /**
   * Apply an updated session summary to the cache in-place. If the project
   * is unknown (e.g. a brand-new project directory) we trigger a full
   * refresh so the cache stays consistent.
   */
  async patchSessionSummary(summary: SessionSummary): Promise<void> {
    if (!this.current) return

    const projectIndex = this.current.projects.findIndex((p) => p.id === summary.projectId)
    if (projectIndex === -1) {
      await this.refresh()
      return
    }

    const project = this.current.projects[projectIndex]
    const sessionIndex = project.sessions.findIndex((s) => s.id === summary.id)
    if (sessionIndex === -1) {
      project.sessions.unshift(summary)
    } else {
      project.sessions[sessionIndex] = summary
    }
  }

  /**
   * Returns the sessions for a project from the cache, or an empty array
   * if the project is unknown.
   */
  async getSessionsForProject(projectId: string): Promise<SessionSummary[]> {
    const scan = await this.get()
    return scan.projects.find((p) => p.id === projectId)?.sessions ?? []
  }
}

export const scanCache = new ScanCache()
