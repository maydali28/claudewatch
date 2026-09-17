import { groupByScope } from '@renderer/components/config/scope-groups'
import type { PlanSummary } from '@shared/types'

export interface PlanGroup {
  key: string
  label: string
  kind: 'global' | 'project'
  directory: string
  plans: PlanSummary[]
}

/**
 * Groups plans by directory the way the sidebar shows them: the `Global`
 * group (default-scope plans) first, then one group per project — keyed by
 * `projectId`, falling back to the directory when a project plan somehow
 * arrives with no id — labelled with the project name (falling back to the
 * directory itself when a project's plans have no name), sorted
 * case-insensitively. Plans keep the order they arrived in within each group.
 * A thin wrapper over the shared `groupByScope` used by the Hooks and
 * Commands sidebars.
 */
export function groupPlansByDirectory(plans: PlanSummary[]): PlanGroup[] {
  const groups = groupByScope(plans, {
    isGlobal: (p) => p.scope === 'default',
    projectKey: (p) => p.projectId ?? p.directory,
    projectName: (p) => p.projectName ?? p.directory,
  })

  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    kind: g.kind,
    directory: g.items[0]?.directory ?? '',
    plans: g.items,
  }))
}

/**
 * The plan id a selection should resolve to: `userSelectedId` itself when it
 * still names a plan in `plans`, otherwise the first plan in *sidebar* order
 * (the Global group first, then alphabetised project groups — see
 * `groupPlansByDirectory`) rather than `plans[0]`, which is sorted by
 * recency and can point at a plan the sidebar doesn't show first. Also
 * covers a stale selection (e.g. after a refresh or a `plansDirectory`
 * change removes the previously-selected plan) by falling back the same
 * way, instead of trying to fetch a plan that no longer exists. Returns
 * `null` when there are no plans at all.
 */
export function pickSelectedPlanId(
  plans: PlanSummary[],
  userSelectedId: string | null
): string | null {
  if (userSelectedId && plans.some((p) => p.id === userSelectedId)) return userSelectedId
  return groupPlansByDirectory(plans)[0]?.plans[0]?.id ?? null
}
