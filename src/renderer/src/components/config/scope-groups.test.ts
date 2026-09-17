import { describe, expect, it } from 'vitest'
import { groupByScope, groupCommandsByScope, groupHooksByScope } from './scope-groups'
import type { CommandEntry, HookEventGroup, HookRule } from '@shared/types'

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

function hookRule(overrides: Partial<HookRule>): HookRule {
  return {
    id: 'user:PreToolUse-0',
    matcher: '',
    hooks: [],
    scope: 'user',
    sourcePath: '/settings.json',
    ...overrides,
  }
}

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
})

// ─── groupCommandsByScope ─────────────────────────────────────────────────────

function command(overrides: Partial<CommandEntry>): CommandEntry {
  return {
    id: 'user:review',
    name: 'review',
    content: '',
    sizeBytes: 0,
    scope: 'user',
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
})
