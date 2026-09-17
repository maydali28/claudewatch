import { describe, expect, it } from 'vitest'
import { groupPlansByDirectory, pickSelectedPlanId } from './group-plans'
import type { PlanSummary } from '@shared/types'

function plan(overrides: Partial<PlanSummary>): PlanSummary {
  return {
    id: '/default/plan.md',
    filename: 'plan.md',
    title: 'Plan',
    directory: '/default',
    scope: 'default',
    sizeBytes: 0,
    ...overrides,
  }
}

describe('groupPlansByDirectory', () => {
  it('puts the default group first, labelled "Plans"', () => {
    const groups = groupPlansByDirectory([plan({ id: '/default/a.md', filename: 'a.md' })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'default', label: 'Plans', directory: '/default' })
  })

  it('groups project plans by directory, labelled with the project name', () => {
    const groups = groupPlansByDirectory([
      plan({ id: '/default/a.md', filename: 'a.md' }),
      plan({
        id: '/proj/plans/x.md',
        filename: 'x.md',
        directory: '/proj/plans',
        scope: 'project',
        projectId: 'proj-1',
        projectName: 'claudewatch',
      }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Plans', 'claudewatch'])
    expect(groups[1].plans.map((p) => p.filename)).toEqual(['x.md'])
  })

  it('sorts multiple project groups by label', () => {
    const groups = groupPlansByDirectory([
      plan({
        id: '/z/plans/z.md',
        filename: 'z.md',
        directory: '/z/plans',
        scope: 'project',
        projectName: 'zeta',
      }),
      plan({
        id: '/a/plans/a.md',
        filename: 'a.md',
        directory: '/a/plans',
        scope: 'project',
        projectName: 'alpha',
      }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'zeta'])
  })

  it('omits the default group entirely when there are no default-scope plans', () => {
    const groups = groupPlansByDirectory([
      plan({
        id: '/proj/plans/x.md',
        filename: 'x.md',
        directory: '/proj/plans',
        scope: 'project',
        projectName: 'claudewatch',
      }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['/proj/plans'])
  })

  it('falls back to the directory as the label when a project plan has no projectName', () => {
    const groups = groupPlansByDirectory([
      plan({
        id: '/proj/plans/x.md',
        filename: 'x.md',
        directory: '/proj/plans',
        scope: 'project',
      }),
    ])
    expect(groups[0].label).toBe('/proj/plans')
  })
})

describe('pickSelectedPlanId', () => {
  // Newest-first overall (what `plans:list` returns) does not match sidebar
  // order (default group first, then alphabetised project groups) — put the
  // "newest" plan in a project group that sorts after the default group, so
  // a wrong fallback to "plans[0]" is distinguishable from the correct
  // "first plan in sidebar order" fallback.
  const newestOverall = plan({
    id: '/proj/plans/newest.md',
    filename: 'newest.md',
    directory: '/proj/plans',
    scope: 'project',
    projectName: 'zzz-project',
  })
  const firstInSidebarOrder = plan({ id: '/default/older.md', filename: 'older.md' })
  const plans = [newestOverall, firstInSidebarOrder]

  it('keeps the user selection when it still exists among the plans', () => {
    expect(pickSelectedPlanId(plans, newestOverall.id)).toBe(newestOverall.id)
  })

  it('falls back to the first plan in sidebar (grouped) order, not plans[0], when nothing is selected', () => {
    expect(pickSelectedPlanId(plans, null)).toBe(firstInSidebarOrder.id)
  })

  it('falls back to sidebar order when the selection is stale (no longer among the plans)', () => {
    expect(pickSelectedPlanId(plans, '/gone/deleted.md')).toBe(firstInSidebarOrder.id)
  })

  it('returns null when there are no plans at all', () => {
    expect(pickSelectedPlanId([], null)).toBeNull()
    expect(pickSelectedPlanId([], 'anything')).toBeNull()
  })

  it('falls back to the first project group in sidebar order when there is no default group', () => {
    const onlyProjectPlans = [newestOverall]
    expect(pickSelectedPlanId(onlyProjectPlans, null)).toBe(newestOverall.id)
  })
})
