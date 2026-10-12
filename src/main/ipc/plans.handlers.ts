import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, PlansGetSchema } from '@shared/ipc/schemas'
import {
  resolvePlanDirectories,
  listPlans,
  readPlan,
  planUsageBySlug,
} from '@main/services/plans-service'
import { resolvedProjectRoots } from '@main/services/project-roots'
import { getOrScanProjects } from './sessions.handlers'

export function registerPlansHandlers(): void {
  ipcMain.handle(CHANNELS.PLANS_LIST, async () => {
    try {
      const [dirs, projects] = await Promise.all([
        resolvedProjectRoots().then(resolvePlanDirectories),
        getOrScanProjects(),
      ])
      const plans = await listPlans(dirs, planUsageBySlug(projects))
      return ok(plans)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })

  ipcMain.handle(CHANNELS.PLANS_GET, async (_event, raw) => {
    try {
      const { id } = validate(PlansGetSchema, raw)
      const dirs = await resolvePlanDirectories(await resolvedProjectRoots())
      const detail = await readPlan(id, dirs)
      return ok(detail)
    } catch (e) {
      // 'Plan not found' is the expected answer for a stale id — the file was
      // deleted or renamed since the list was rendered, or the id pointed
      // outside a known plans directory. It is a normal outcome, not a crash
      // worth a Sentry event.
      if (!(e instanceof Error && e.message === 'Plan not found')) captureHandlerException(e)
      return err(toSafeError(e))
    }
  })
}
