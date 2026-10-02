import { describe, expect, it } from 'vitest'
import {
  abbreviateHome,
  filterPlansByFolder,
  groupPlans,
  pickSelectedPlanId,
  planFolderCounts,
} from './group-plans'
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

const projectPlan = (overrides: Partial<PlanSummary>): PlanSummary =>
  plan({ directory: '/proj/plans', scope: 'project', ...overrides })

describe('groupPlans', () => {
  it('puts shared-folder plans no project used first, labelled "Global"', () => {
    const groups = groupPlans([plan({ id: '/default/a.md', filename: 'a.md', usedBy: [] })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      key: 'global',
      label: 'Global',
      kind: 'global',
      folders: ['/default'],
    })
  })

  it('treats a shared-folder plan without usage data as Global', () => {
    const groups = groupPlans([plan({ id: '/default/a.md' })])
    expect(groups.map((g) => g.key)).toEqual(['global'])
  })

  it('lists a shared-folder plan under the project that used it, not under Global', () => {
    const groups = groupPlans([
      plan({
        id: '/default/a.md',
        usedBy: [{ projectId: 'proj-1', projectName: 'claudewatch' }],
      }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['claudewatch'])
    expect(groups[0]).toMatchObject({ key: 'proj-1', kind: 'project', folders: ['/default'] })
  })

  it('lists a shared-folder plan under every project that used it', () => {
    const shared = plan({
      id: '/default/a.md',
      usedBy: [
        { projectId: 'proj-1', projectName: 'claudewatch' },
        { projectId: 'proj-2', projectName: 'alpha' },
      ],
    })
    const groups = groupPlans([shared])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'claudewatch'])
    expect(groups.every((g) => g.plans[0] === shared)).toBe(true)
  })

  it('merges a project folder plan and a shared plan of the same project into one group, with both folders', () => {
    const groups = groupPlans([
      projectPlan({
        id: '/proj/plans/x.md',
        filename: 'x.md',
        projectId: 'proj-1',
        projectName: 'claudewatch',
      }),
      plan({
        id: '/default/a.md',
        usedBy: [{ projectId: 'proj-1', projectName: 'claudewatch' }],
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].folders).toEqual(['/proj/plans', '/default'])
    expect(groups[0].plans.map((p) => p.id)).toEqual(['/proj/plans/x.md', '/default/a.md'])
  })

  it('sorts project groups by label after Global', () => {
    const groups = groupPlans([
      projectPlan({
        id: '/z/plans/z.md',
        directory: '/z/plans',
        projectId: 'z',
        projectName: 'zeta',
      }),
      plan({ id: '/default/g.md', usedBy: [] }),
      projectPlan({
        id: '/a/plans/a.md',
        directory: '/a/plans',
        projectId: 'a',
        projectName: 'alpha',
      }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Global', 'alpha', 'zeta'])
  })

  it('falls back to the directory as key and label when a project plan has no project', () => {
    const groups = groupPlans([projectPlan({ id: '/proj/plans/x.md' })])
    expect(groups[0]).toMatchObject({ key: '/proj/plans', label: '/proj/plans' })
  })
})

describe('filterPlansByFolder and planFolderCounts', () => {
  const plans = [
    plan({ id: '/default/a.md' }),
    plan({ id: '/default/b.md' }),
    projectPlan({ id: '/proj/plans/x.md' }),
  ]

  it('keeps every plan for "all", shared-folder plans for "shared", project-folder plans for "project"', () => {
    expect(filterPlansByFolder(plans, 'all')).toHaveLength(3)
    expect(filterPlansByFolder(plans, 'shared').map((p) => p.id)).toEqual([
      '/default/a.md',
      '/default/b.md',
    ])
    expect(filterPlansByFolder(plans, 'project').map((p) => p.id)).toEqual(['/proj/plans/x.md'])
  })

  it('counts plans per folder kind', () => {
    expect(planFolderCounts(plans)).toEqual({ all: 3, shared: 2, project: 1 })
  })
})

describe('abbreviateHome', () => {
  const paths = { claudeDir: '/Users/me/.claude', display: '~/.claude' }

  it('replaces the home directory with ~', () => {
    expect(abbreviateHome('/Users/me/.claude/plans', paths)).toBe('~/.claude/plans')
    expect(abbreviateHome('/Users/me/repo/docs/plans', paths)).toBe('~/repo/docs/plans')
  })

  it('leaves paths outside home, and lookalike prefixes, unchanged', () => {
    expect(abbreviateHome('/opt/plans', paths)).toBe('/opt/plans')
    expect(abbreviateHome('/Users/meow/plans', paths)).toBe('/Users/meow/plans')
  })

  it('leaves every path unchanged when the Claude folder is not shown relative to home', () => {
    expect(
      abbreviateHome('/srv/claude/plans', { claudeDir: '/srv/claude', display: '/srv/claude' })
    ).toBe('/srv/claude/plans')
  })
})

describe('pickSelectedPlanId', () => {
  // Newest-first overall (what `plans:list` returns) does not match sidebar
  // order (Global first, then alphabetised project groups) — put the
  // "newest" plan in a project group that sorts after Global, so a wrong
  // fallback to "plans[0]" is distinguishable from the correct "first plan
  // in sidebar order" fallback.
  const newestOverall = projectPlan({
    id: '/proj/plans/newest.md',
    filename: 'newest.md',
    projectId: 'zzz',
    projectName: 'zzz-project',
  })
  const firstInSidebarOrder = plan({ id: '/default/older.md', filename: 'older.md', usedBy: [] })
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

  it('falls back to the first project group in sidebar order when there is no Global group', () => {
    expect(pickSelectedPlanId([newestOverall], null)).toBe(newestOverall.id)
  })
})
