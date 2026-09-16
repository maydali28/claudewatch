import type { Project } from '@shared/types/project'
import type { ProjectCost } from '@shared/types/analytics'

/**
 * Whether a project belongs in the analytics sidebar's project list for the
 * currently selected day range.
 *
 * `stats` is the row `baselineData.projectCosts` produced for this project
 * over the selected range — `undefined` when the range has no rows for it at
 * all. Activity is judged by `messageCount`, not `totalCost`: a project can
 * run entirely on cached/free tokens and legitimately show `totalCost === 0`
 * while still being fully active, so cost is not a safe "did anything
 * happen" signal. `messageCount` is zero only when nothing was said in the
 * project during the range, which is what "no activity of any kind" means
 * here.
 *
 * Two overrides keep the list navigable and predictable even when a project
 * reads as idle:
 *  - the selected project always stays, even at zero activity — otherwise
 *    selecting an idle project would make it vanish from its own list and
 *    strand the user with no row to click back out of;
 *  - while a search string is present, a name match always stays regardless
 *    of activity — the user asked for it by name, so idleness shouldn't
 *    hide it.
 *
 * A project whose name doesn't match a present search is excluded either
 * way, matching the sidebar's pre-existing search behavior.
 */
export function isProjectVisibleInRange(
  project: Pick<Project, 'id' | 'name'>,
  stats: Pick<ProjectCost, 'messageCount'> | undefined,
  selectedProjectId: string | null,
  search: string
): boolean {
  const isSearching = search.length > 0
  const matchesSearch = !isSearching || project.name.toLowerCase().includes(search.toLowerCase())

  if (!matchesSearch) return false
  if (isSearching) return true // search wins over idleness
  if (project.id === selectedProjectId) return true // selection stays reachable

  return (stats?.messageCount ?? 0) > 0
}
