import type { Project } from '@shared/types/project'
import type { SeenModel } from '@shared/types/pricing'
import { UNDATED_DAY } from '@shared/utils/date-ranges'

/**
 * Every model ID the scanned transcripts used, with how many responses it
 * made and how many of those could not be priced. Unpriced models come first:
 * they are the ones Settings › Models asks the user to map.
 */
export function listSeenModels(projects: Project[]): SeenModel[] {
  const byModel = new Map<string, SeenModel>()
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const day of session.dailyUsage) {
        for (const m of day.models) {
          if (!m.model) continue
          const row = byModel.get(m.model) ?? {
            model: m.model,
            family: m.family,
            responses: 0,
            unpricedResponses: 0,
            lastDay: '',
          }
          row.responses += m.turnCount
          if (m.estimatedCost === null) row.unpricedResponses += m.turnCount
          if (day.day !== UNDATED_DAY && day.day > row.lastDay) row.lastDay = day.day
          byModel.set(m.model, row)
        }
      }
    }
  }
  return [...byModel.values()].sort(
    (a, b) =>
      Number(b.unpricedResponses > 0) - Number(a.unpricedResponses > 0) ||
      b.responses - a.responses ||
      a.model.localeCompare(b.model)
  )
}
