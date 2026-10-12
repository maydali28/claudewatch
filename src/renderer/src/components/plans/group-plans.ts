import type { PlanSummary } from '@shared/types'

export interface PlanGroup {
  key: string
  label: string
  kind: 'global' | 'project'
  /** Distinct folders this group's plans live in, in the order first seen. */
  folders: string[]
  plans: PlanSummary[]
}

/**
 * Groups plans the way the sidebar shows them: `Global` first, then one group
 * per project sorted by label case-insensitively.
 *
 * - A plan in a project's own `plansDirectory` goes to that project, keyed by
 *   `projectId` (the directory when a plan somehow arrives without one).
 * - A plan in the shared folder goes to every project whose sessions used it
 *   (`usedBy`), and to `Global` only when none did — so the same plan can
 *   appear in more than one project group.
 *
 * Plans keep the order they arrived in within each group.
 */
export function groupPlans(plans: PlanSummary[]): PlanGroup[] {
  const global: PlanSummary[] = []
  const projects = new Map<string, { label: string; plans: PlanSummary[] }>()

  const addTo = (key: string, label: string, p: PlanSummary): void => {
    let group = projects.get(key)
    if (!group) {
      group = { label, plans: [] }
      projects.set(key, group)
    }
    group.plans.push(p)
  }

  for (const p of plans) {
    if (p.scope === 'project') {
      addTo(p.projectId ?? p.directory, p.projectName ?? p.directory, p)
    } else if (p.usedBy && p.usedBy.length > 0) {
      for (const ref of p.usedBy) addTo(ref.projectId, ref.projectName, p)
    } else {
      global.push(p)
    }
  }

  const groups: PlanGroup[] = []
  if (global.length > 0) {
    groups.push({
      key: 'global',
      label: 'Global',
      kind: 'global',
      folders: foldersOf(global),
      plans: global,
    })
  }
  groups.push(
    ...[...projects.entries()]
      .map(([key, g]) => ({
        key,
        label: g.label,
        kind: 'project' as const,
        folders: foldersOf(g.plans),
        plans: g.plans,
      }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
  )
  return groups
}

function foldersOf(plans: PlanSummary[]): string[] {
  return [...new Set(plans.map((p) => p.directory))]
}

export type PlanFolderFilter = 'all' | 'project' | 'shared'

/** `shared` keeps plans in the shared folder; `project` keeps plans in a project's own `plansDirectory`. */
export function filterPlansByFolder(plans: PlanSummary[], filter: PlanFolderFilter): PlanSummary[] {
  if (filter === 'all') return plans
  return plans.filter((p) => (filter === 'shared' ? p.scope === 'default' : p.scope === 'project'))
}

export function planFolderCounts(plans: PlanSummary[]): Record<PlanFolderFilter, number> {
  const shared = plans.filter((p) => p.scope === 'default').length
  return { all: plans.length, shared, project: plans.length - shared }
}

/**
 * `dir` with the home directory shown as `~`. Home is derived from the
 * resolved Claude folder and how it is displayed (`~/.claude` for
 * `/Users/me/.claude`); when the folder is not displayed relative to home,
 * paths are returned unchanged.
 */
export function abbreviateHome(dir: string, paths: { claudeDir: string; display: string }): string {
  if (!paths.display.startsWith('~')) return dir
  const tail = paths.display.slice(1)
  if (!paths.claudeDir.endsWith(tail)) return dir
  const home = paths.claudeDir.slice(0, paths.claudeDir.length - tail.length)
  if (!home) return dir
  if (dir === home) return '~'
  const sep = home.includes('\\') ? '\\' : '/'
  return dir.startsWith(home + sep) ? `~${dir.slice(home.length)}` : dir
}

/**
 * The plan id a selection should resolve to: `userSelectedId` itself when it
 * still names a plan in `plans`, otherwise the first plan in *sidebar* order
 * (see `groupPlans`) rather than `plans[0]`, which is sorted by recency and
 * can point at a plan the sidebar doesn't show first. Also covers a stale
 * selection (e.g. after a refresh or a `plansDirectory` change removes the
 * previously-selected plan) by falling back the same way. Returns `null` when
 * there are no plans at all.
 */
export function pickSelectedPlanId(
  plans: PlanSummary[],
  userSelectedId: string | null
): string | null {
  if (userSelectedId && plans.some((p) => p.id === userSelectedId)) return userSelectedId
  return groupPlans(plans)[0]?.plans[0]?.id ?? null
}
