import type { PlanSummary } from '@shared/types'

export interface PlanGroup {
  key: string
  label: string
  directory: string
  plans: PlanSummary[]
}

/**
 * Groups plans by the directory they were found in: the default group
 * ("Plans") first, then one group per project directory, each labelled with
 * the project name (falling back to the directory itself if a project's
 * plans somehow arrive with no name). Plans keep the order they arrived in
 * within each group.
 */
export function groupPlansByDirectory(plans: PlanSummary[]): PlanGroup[] {
  const defaultPlans = plans.filter((p) => p.scope === 'default')
  const projectGroups = new Map<string, PlanGroup>()

  for (const plan of plans) {
    if (plan.scope !== 'project') continue
    let group = projectGroups.get(plan.directory)
    if (!group) {
      group = {
        key: plan.directory,
        label: plan.projectName ?? plan.directory,
        directory: plan.directory,
        plans: [],
      }
      projectGroups.set(plan.directory, group)
    }
    group.plans.push(plan)
  }

  const groups: PlanGroup[] = []
  if (defaultPlans.length > 0) {
    groups.push({
      key: 'default',
      label: 'Plans',
      directory: defaultPlans[0].directory,
      plans: defaultPlans,
    })
  }
  groups.push(...[...projectGroups.values()].sort((a, b) => a.label.localeCompare(b.label)))
  return groups
}

/**
 * The plan id a selection should resolve to: `userSelectedId` itself when it
 * still names a plan in `plans`, otherwise the first plan in *sidebar* order
 * (the default group first, then alphabetised project groups — see
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
