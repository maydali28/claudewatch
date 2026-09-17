import type { CommandEntry, HookEventGroup, HookRule } from '@shared/types'

/**
 * One group of items in a "Global, then per-project" sidebar: `Global` first
 * (present only when it has items), then one group per project, sorted by
 * label case-insensitively. Items keep the order they arrived in.
 */
export interface ScopeGroup<T> {
  key: string
  label: string
  kind: 'global' | 'project'
  items: T[]
}

export interface GroupByScopeOptions<T> {
  isGlobal(item: T): boolean
  projectKey(item: T): string
  projectName(item: T): string
}

/**
 * Groups `items` into a `Global` bucket followed by one bucket per project,
 * sorted by label case-insensitively. An item is global when `isGlobal`
 * says so, or — defensively — when it isn't global but also has no usable
 * `projectKey` (an empty string counts as "no key").
 */
export function groupByScope<T>(items: T[], opts: GroupByScopeOptions<T>): ScopeGroup<T>[] {
  const globalItems: T[] = []
  const projectGroups = new Map<string, { label: string; items: T[] }>()

  for (const item of items) {
    const key = opts.isGlobal(item) ? '' : opts.projectKey(item)
    if (!key) {
      globalItems.push(item)
      continue
    }
    let group = projectGroups.get(key)
    if (!group) {
      group = { label: opts.projectName(item) || key, items: [] }
      projectGroups.set(key, group)
    }
    group.items.push(item)
  }

  const groups: ScopeGroup<T>[] = []
  if (globalItems.length > 0) {
    groups.push({ key: 'global', label: 'Global', kind: 'global', items: globalItems })
  }
  groups.push(
    ...[...projectGroups.entries()]
      .map(([key, g]) => ({ key, label: g.label, kind: 'project' as const, items: g.items }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
  )
  return groups
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export interface HookScopeEventGroup {
  id: string
  event: string
  rules: HookRule[]
}

export interface HookScopeGroup {
  key: string
  label: string
  kind: 'global' | 'project'
  eventGroups: HookScopeEventGroup[]
}

interface FlatHookRule {
  eventGroupId: string
  event: string
  rule: HookRule
}

/**
 * Hook rules grouped `Global` (scope `user`) then one group per project
 * (that project's `project` and `local` rules together — a project group
 * doesn't distinguish the two; rule items still carry their own scope).
 * Within each scope group, rules are nested one sub-group per event, in the
 * order events first appear, keeping the original event group's `id` so
 * `hooks-panel.tsx`'s `${eventGroupId}::${rule.id}` selection ids still
 * resolve.
 */
export function groupHooksByScope(hookGroups: HookEventGroup[]): HookScopeGroup[] {
  const flat: FlatHookRule[] = []
  for (const g of hookGroups) {
    for (const rule of g.rules) {
      flat.push({ eventGroupId: g.id, event: g.event, rule })
    }
  }

  const scopeGroups = groupByScope(flat, {
    isGlobal: (f) => f.rule.scope === 'user',
    projectKey: (f) => f.rule.projectId ?? '',
    projectName: (f) => f.rule.projectName ?? '',
  })

  return scopeGroups.map((sg) => ({
    key: sg.key,
    label: sg.label,
    kind: sg.kind,
    eventGroups: groupFlatRulesByEvent(sg.items),
  }))
}

function groupFlatRulesByEvent(items: FlatHookRule[]): HookScopeEventGroup[] {
  const byEvent = new Map<string, HookScopeEventGroup>()
  for (const item of items) {
    let group = byEvent.get(item.event)
    if (!group) {
      group = { id: item.eventGroupId, event: item.event, rules: [] }
      byEvent.set(item.event, group)
    }
    group.rules.push(item.rule)
  }
  return [...byEvent.values()]
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/** Commands grouped `Global` (scope `user`) then one group per project (scope `project`, by `projectId`). */
export function groupCommandsByScope(commands: CommandEntry[]): ScopeGroup<CommandEntry>[] {
  return groupByScope(commands, {
    isGlobal: (c) => c.scope === 'user',
    projectKey: (c) => c.projectId ?? '',
    projectName: (c) => c.projectName ?? '',
  })
}
