import type { CommandEntry, ConfigSource, HookEventGroup, HookRule } from '@shared/types'

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

// ─── Groups by source ─────────────────────────────────────────────────────────

export type SourceGroupKind = 'global' | 'project' | 'plugin' | 'managed' | 'builtin'

/** One sidebar group of items sharing a source (a project's `local` items join its project). */
export interface SourceGroup<T> {
  key: string
  label: string
  kind: SourceGroupKind
  /** The plugin's source for a plugin group, for its version and tags. */
  source?: ConfigSource
  items: T[]
}

const KIND_RANK: Record<SourceGroupKind, number> = {
  global: 0,
  project: 1,
  plugin: 2,
  managed: 3,
  builtin: 4,
}

function groupKindOf(source: ConfigSource): SourceGroupKind {
  switch (source.kind) {
    case 'user':
      return 'global'
    case 'project':
    case 'local':
      return 'project'
    default:
      return source.kind
  }
}

function groupKeyOf(source: ConfigSource, kind: SourceGroupKind): string {
  switch (kind) {
    case 'global':
      return 'global'
    case 'project':
      return source.projectId ?? source.id
    default:
      return source.id
  }
}

/**
 * Groups items by source in the order the setup sidebars show them: Global,
 * then projects, then plugins (each alphabetically, case-insensitively), then
 * Managed, then Built-in. Empty groups never appear; items keep their order.
 */
export function groupBySource<T>(
  items: T[],
  sourceOf: (item: T) => ConfigSource
): SourceGroup<T>[] {
  const groups = new Map<string, SourceGroup<T>>()
  for (const item of items) {
    const source = sourceOf(item)
    const kind = groupKindOf(source)
    const key = groupKeyOf(source, kind)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label: kind === 'global' ? 'Global' : (source.projectName ?? source.label),
        kind,
        ...(kind === 'plugin' ? { source } : {}),
        items: [],
      }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  return [...groups.values()].sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.label.toLowerCase().localeCompare(b.label.toLowerCase())
  )
}

// ─── Source filter ────────────────────────────────────────────────────────────

/** The source chips above a setup sidebar. A project's `local` items count as Project. */
export type SourceFilter = 'all' | 'user' | 'project' | 'plugin' | 'managed' | 'builtin'

export function sourceFilterOf(source: ConfigSource): Exclude<SourceFilter, 'all'> {
  return source.kind === 'local' ? 'project' : source.kind
}

export function matchesSourceFilter(source: ConfigSource, filter: SourceFilter): boolean {
  return filter === 'all' || sourceFilterOf(source) === filter
}

export function countBySourceFilter<T>(
  items: T[],
  sourceOf: (item: T) => ConfigSource
): Record<SourceFilter, number> {
  const counts: Record<SourceFilter, number> = {
    all: items.length,
    user: 0,
    project: 0,
    plugin: 0,
    managed: 0,
    builtin: 0,
  }
  for (const item of items) counts[sourceFilterOf(sourceOf(item))]++
  return counts
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
  kind: SourceGroupKind
  source?: ConfigSource
  eventGroups: HookScopeEventGroup[]
}

interface FlatHookRule {
  eventGroupId: string
  event: string
  rule: HookRule
}

/**
 * Hook rules grouped by source (see `groupBySource`): a project's `project`
 * and `local` rules share its group; rule items still carry their own scope.
 * Within each group, rules are nested one sub-group per event, in the order
 * events first appear, keeping the original event group's `id` so
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

  return groupBySource(flat, (f) => f.rule.source).map((sg) => ({
    key: sg.key,
    label: sg.label,
    kind: sg.kind,
    ...(sg.source ? { source: sg.source } : {}),
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

/** Commands grouped by source: Global, then each project, then each plugin (see `groupBySource`). */
export function groupCommandsByScope(commands: CommandEntry[]): SourceGroup<CommandEntry>[] {
  return groupBySource(commands, (c) => c.source)
}
