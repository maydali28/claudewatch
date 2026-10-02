import { describe, expect, it } from 'vitest'
import {
  countBySourceFilter,
  groupByScope,
  groupCommandsByScope,
  groupHooksByScope,
  matchesSourceFilter,
  sourceFilterOf,
} from './scope-groups'
import type { CommandEntry, ConfigSource, HookEventGroup, HookRule } from '@shared/types'

// ─── groupByScope ─────────────────────────────────────────────────────────────

interface Item {
  id: string
  scope: 'global' | 'project'
  project?: string
  projectLabel?: string
}

function item(overrides: Partial<Item>): Item {
  return { id: 'a', scope: 'global', ...overrides }
}

const opts = {
  isGlobal: (i: Item) => i.scope === 'global',
  projectKey: (i: Item) => i.project ?? '',
  projectName: (i: Item) => i.projectLabel ?? i.project ?? '',
}

describe('groupByScope', () => {
  it('puts the Global group first, labelled "Global"', () => {
    const groups = groupByScope([item({ id: 'a' })], opts)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'global', label: 'Global', kind: 'global' })
  })

  it('omits the Global group entirely when there are no global items', () => {
    const groups = groupByScope(
      [item({ id: 'a', scope: 'project', project: 'p1', projectLabel: 'claudewatch' })],
      opts
    )
    expect(groups.map((g) => g.kind)).toEqual(['project'])
  })

  it('sorts project groups by label, case-insensitively', () => {
    const groups = groupByScope(
      [
        item({ id: 'z', scope: 'project', project: 'p-zeta', projectLabel: 'Zeta' }),
        item({ id: 'a', scope: 'project', project: 'p-alpha', projectLabel: 'alpha' }),
        item({ id: 'b', scope: 'project', project: 'p-Beta', projectLabel: 'Beta' }),
      ],
      opts
    )
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'Beta', 'Zeta'])
  })

  it('keeps items in their incoming order within a group', () => {
    const groups = groupByScope(
      [
        item({ id: 'first', scope: 'project', project: 'p1' }),
        item({ id: 'second', scope: 'project', project: 'p1' }),
      ],
      opts
    )
    expect(groups[0].items.map((i) => i.id)).toEqual(['first', 'second'])
  })

  it('sends items that are neither global nor carry a project key to Global (defensive)', () => {
    const groups = groupByScope(
      [item({ id: 'orphan', scope: 'project', project: undefined })],
      opts
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('global')
    expect(groups[0].items.map((i) => i.id)).toEqual(['orphan'])
  })

  it('places Global before project groups even when project labels sort earlier', () => {
    const groups = groupByScope(
      [
        item({ id: 'p', scope: 'project', project: 'p1', projectLabel: 'aaa-project' }),
        item({ id: 'g', scope: 'global' }),
      ],
      opts
    )
    expect(groups.map((g) => g.kind)).toEqual(['global', 'project'])
  })
})

// ─── groupHooksByScope ────────────────────────────────────────────────────────

function sourceFor(rule: Partial<HookRule>): ConfigSource {
  switch (rule.scope) {
    case 'project':
    case 'local':
      return {
        kind: rule.scope,
        id: `${rule.scope}:${rule.projectId}`,
        label: rule.projectName ?? '',
        projectId: rule.projectId,
        projectName: rule.projectName,
      }
    default:
      return USER_SOURCE
  }
}

function hookRule(overrides: Partial<HookRule>): HookRule {
  return {
    id: 'user:PreToolUse-0',
    matcher: '',
    hooks: [],
    scope: 'user',
    sourcePath: '/settings.json',
    source: sourceFor(overrides),
    ...overrides,
  }
}

const USER_SOURCE: ConfigSource = { kind: 'user', id: 'user', label: 'Global' }
const pluginSource = (name: string, enabled = true): ConfigSource => ({
  kind: 'plugin',
  id: `plugin:${name}@m`,
  label: name,
  root: `/plugins/${name}`,
  plugin: { name, marketplace: 'm', origin: 'marketplace', enabled },
})
const MANAGED: ConfigSource = { kind: 'managed', id: 'managed', label: 'Managed' }

describe('groupHooksByScope', () => {
  it('groups user-scope rules under Global', () => {
    const hooks: HookEventGroup[] = [
      { id: 'PreToolUse', event: 'PreToolUse', rules: [hookRule({ id: 'user:PreToolUse-0' })] },
    ]
    const groups = groupHooksByScope(hooks)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'global', label: 'Global', kind: 'global' })
    expect(groups[0].eventGroups).toEqual([
      { id: 'PreToolUse', event: 'PreToolUse', rules: [hookRule({ id: 'user:PreToolUse-0' })] },
    ])
  })

  it('merges a project\'s "project" and "local" rules into a single project group', () => {
    const hooks: HookEventGroup[] = [
      {
        id: 'PreToolUse',
        event: 'PreToolUse',
        rules: [
          hookRule({
            id: 'project:proj-1:PreToolUse-0',
            scope: 'project',
            projectId: 'proj-1',
            projectName: 'claudewatch',
          }),
          hookRule({
            id: 'local:proj-1:PreToolUse-0',
            scope: 'local',
            projectId: 'proj-1',
            projectName: 'claudewatch',
          }),
        ],
      },
    ]
    const groups = groupHooksByScope(hooks)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'proj-1', label: 'claudewatch', kind: 'project' })
    expect(groups[0].eventGroups[0].rules).toHaveLength(2)
  })

  it('splits two projects into two project groups, sorted by project name', () => {
    const hooks: HookEventGroup[] = [
      {
        id: 'PreToolUse',
        event: 'PreToolUse',
        rules: [
          hookRule({
            id: 'project:proj-z:PreToolUse-0',
            scope: 'project',
            projectId: 'proj-z',
            projectName: 'zeta',
          }),
          hookRule({
            id: 'project:proj-a:PreToolUse-0',
            scope: 'project',
            projectId: 'proj-a',
            projectName: 'alpha',
          }),
        ],
      },
    ]
    const groups = groupHooksByScope(hooks)
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'zeta'])
  })

  it('nests rules under one sub-group per event, keeping the original event group id', () => {
    const hooks: HookEventGroup[] = [
      {
        id: 'PreToolUse',
        event: 'PreToolUse',
        rules: [hookRule({ id: 'user:PreToolUse-0' })],
      },
      {
        id: 'PostToolUse',
        event: 'PostToolUse',
        rules: [hookRule({ id: 'user:PostToolUse-0' })],
      },
    ]
    const groups = groupHooksByScope(hooks)
    expect(groups[0].eventGroups.map((eg) => [eg.id, eg.event])).toEqual([
      ['PreToolUse', 'PreToolUse'],
      ['PostToolUse', 'PostToolUse'],
    ])
  })

  it('returns no groups for an empty hooks list', () => {
    expect(groupHooksByScope([])).toEqual([])
  })

  it('puts plugin groups after projects, sorted by name, and Managed last', () => {
    const hooks: HookEventGroup[] = [
      {
        id: 'SessionStart',
        event: 'SessionStart',
        rules: [
          hookRule({ id: 'managed:SessionStart-0', scope: 'managed', source: MANAGED }),
          hookRule({
            id: 'plugin:zz@m:SessionStart-0',
            scope: 'plugin',
            source: pluginSource('zz'),
          }),
          hookRule({
            id: 'plugin:aa@m:SessionStart-0',
            scope: 'plugin',
            source: pluginSource('aa'),
          }),
          hookRule({
            id: 'project:p:SessionStart-0',
            scope: 'project',
            projectId: 'p',
            projectName: 'zzz-project',
          }),
          hookRule({ id: 'user:SessionStart-0' }),
        ],
      },
    ]
    const groups = groupHooksByScope(hooks)
    expect(groups.map((g) => [g.kind, g.label])).toEqual([
      ['global', 'Global'],
      ['project', 'zzz-project'],
      ['plugin', 'aa'],
      ['plugin', 'zz'],
      ['managed', 'Managed'],
    ])
    expect(groups[2].source).toEqual(pluginSource('aa'))
  })
})

// ─── Source filter ────────────────────────────────────────────────────────────

describe('sourceFilterOf, matchesSourceFilter and countBySourceFilter', () => {
  const local: ConfigSource = { kind: 'local', id: 'local:p', label: 'p', projectId: 'p' }
  const builtin: ConfigSource = { kind: 'builtin', id: 'builtin', label: 'Built-in' }

  it('files a local item under Project, everything else under its own kind', () => {
    expect(sourceFilterOf(USER_SOURCE)).toBe('user')
    expect(sourceFilterOf(local)).toBe('project')
    expect(sourceFilterOf(pluginSource('a'))).toBe('plugin')
    expect(sourceFilterOf(MANAGED)).toBe('managed')
    expect(sourceFilterOf(builtin)).toBe('builtin')
  })

  it('matches every source for "all" and only its own kind otherwise', () => {
    expect(matchesSourceFilter(MANAGED, 'all')).toBe(true)
    expect(matchesSourceFilter(local, 'project')).toBe(true)
    expect(matchesSourceFilter(local, 'user')).toBe(false)
  })

  it('counts items per filter, with All covering every item', () => {
    const items = [USER_SOURCE, local, local, pluginSource('a'), MANAGED]
    expect(countBySourceFilter(items, (s) => s)).toEqual({
      all: 5,
      user: 1,
      project: 2,
      plugin: 1,
      managed: 1,
      builtin: 0,
    })
  })
})

// ─── groupCommandsByScope ─────────────────────────────────────────────────────

function command(overrides: Partial<CommandEntry>): CommandEntry {
  const source: ConfigSource =
    overrides.scope === 'project'
      ? {
          kind: 'project',
          id: `project:${overrides.projectId}`,
          label: overrides.projectName ?? '',
          projectId: overrides.projectId,
          projectName: overrides.projectName,
        }
      : USER_SOURCE
  return {
    id: 'user:review',
    name: 'review',
    content: '',
    sizeBytes: 0,
    scope: 'user',
    source,
    filePath: '/commands/review.md',
    ...overrides,
  }
}

describe('groupCommandsByScope', () => {
  it('groups user-scope commands under Global', () => {
    const groups = groupCommandsByScope([command({ id: 'user:review' })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'global', label: 'Global', kind: 'global' })
  })

  it('groups project-scope commands by projectId, two projects sorted by name', () => {
    const groups = groupCommandsByScope([
      command({
        id: 'project:proj-z:ship',
        name: 'ship',
        scope: 'project',
        projectId: 'proj-z',
        projectName: 'zeta',
      }),
      command({
        id: 'project:proj-a:build',
        name: 'build',
        scope: 'project',
        projectId: 'proj-a',
        projectName: 'alpha',
      }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'zeta'])
    expect(groups[0].items.map((c) => c.name)).toEqual(['build'])
    expect(groups[1].items.map((c) => c.name)).toEqual(['ship'])
  })

  it('gives each plugin its own group after the projects', () => {
    const groups = groupCommandsByScope([
      command({
        id: 'plugin:seo@m:/c.md',
        name: 'seo:check',
        scope: 'plugin',
        source: pluginSource('seo'),
      }),
      command({ id: 'user:review' }),
    ])
    expect(groups.map((g) => [g.kind, g.label])).toEqual([
      ['global', 'Global'],
      ['plugin', 'seo'],
    ])
    expect(groups[1].source).toEqual(pluginSource('seo'))
  })
})
