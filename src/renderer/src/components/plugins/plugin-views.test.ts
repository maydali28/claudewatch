import { describe, expect, it } from 'vitest'
import {
  buildPluginViews,
  findPluginItem,
  defaultPluginTab,
  isPluginSourced,
  pluginItemSummary,
} from './plugin-views'
import type {
  CommandEntry,
  ConfigSource,
  HookEventGroup,
  PluginEntry,
  SkillEntry,
} from '@shared/types'

const plugin = (name: string, extra: Partial<ConfigSource['plugin']> = {}): ConfigSource => ({
  kind: 'plugin',
  id: `plugin:${name}@m`,
  label: name,
  root: `/plugins/${name}`,
  plugin: { name, marketplace: 'm', origin: 'marketplace', enabled: true, ...extra },
})
const USER: ConfigSource = { kind: 'user', id: 'user', label: 'Global' }

const skill = (name: string, source: ConfigSource): SkillEntry => ({
  id: `${source.id}:${name}`,
  name,
  displayName: name,
  metadata: {},
  body: '',
  sizeBytes: 0,
  source,
})
const command = (name: string, source: ConfigSource): CommandEntry => ({
  id: `${source.id}:${name}`,
  name,
  content: '',
  sizeBytes: 0,
  scope: source.kind === 'plugin' ? 'plugin' : 'user',
  source,
  filePath: `/${name}.md`,
})

describe('isPluginSourced', () => {
  it('is true for items from a plugin only', () => {
    expect(isPluginSourced(plugin('a'))).toBe(true)
    expect(isPluginSourced(USER)).toBe(false)
    expect(isPluginSourced(undefined)).toBe(false)
  })
})

describe('buildPluginViews', () => {
  const superpowers = plugin('superpowers', { version: '6.4.1' })
  const seo = plugin('searchfit-seo', { origin: 'claude.ai', marketplace: undefined })
  const claudeAi: ConfigSource = {
    kind: 'plugin',
    id: 'plugin:anthropic-skills@claude.ai',
    label: 'anthropic-skills',
    plugin: { name: 'anthropic-skills', origin: 'claude.ai', enabled: true },
  }
  const plugins: PluginEntry[] = [
    { source: superpowers, description: 'Core skills' },
    { source: seo },
    { source: plugin('empty') },
  ]
  const hooks: HookEventGroup[] = [
    {
      id: 'SessionStart',
      event: 'SessionStart',
      rules: [
        {
          id: 'plugin:superpowers@m:SessionStart-0',
          matcher: 'startup',
          hooks: [{ command: 'run.sh' }],
          scope: 'plugin',
          sourcePath: '/hooks.json',
          source: superpowers,
        },
        {
          id: 'user:SessionStart-0',
          matcher: '',
          hooks: [{ command: 'mine.sh' }],
          scope: 'user',
          sourcePath: '/settings.json',
          source: USER,
        },
      ],
    },
  ]

  const views = buildPluginViews(
    plugins,
    [
      skill('superpowers:brainstorming', superpowers),
      skill('anthropic-skills:docx', claudeAi),
      skill('humanizer', USER),
    ],
    [command('searchfit-seo:seo-check', seo), command('deploy', USER)],
    hooks
  )

  it('makes one view per installed plugin, plus plugins known only from skills, sorted by name', () => {
    expect(views.map((v) => v.source.label)).toEqual([
      'anthropic-skills',
      'empty',
      'searchfit-seo',
      'superpowers',
    ])
  })

  it('puts each plugin’s skills, commands and hooks in its view, and nothing of the user’s', () => {
    const sp = views.find((v) => v.source.label === 'superpowers')!
    expect(sp.description).toBe('Core skills')
    expect(sp.skills.map((s) => s.name)).toEqual(['superpowers:brainstorming'])
    expect(sp.hooks).toEqual([
      { event: 'SessionStart', eventGroupId: 'SessionStart', rule: hooks[0].rules[0] },
    ])
    expect(
      views.find((v) => v.source.label === 'searchfit-seo')!.commands.map((c) => c.name)
    ).toEqual(['searchfit-seo:seo-check'])
    expect(views.find((v) => v.source.label === 'empty')).toMatchObject({
      skills: [],
      commands: [],
      hooks: [],
    })
  })

  it('finds the skill, command or hook a click selected, and nothing for a stale id', () => {
    const sp = views.find((v) => v.source.label === 'superpowers')!
    const seoView = views.find((v) => v.source.label === 'searchfit-seo')!
    expect(
      findPluginItem(sp, { kind: 'skills', id: 'plugin:superpowers@m:superpowers:brainstorming' })
    ).toMatchObject({ kind: 'skills', item: { name: 'superpowers:brainstorming' } })
    expect(findPluginItem(seoView, { kind: 'commands', id: seoView.commands[0].id })).toMatchObject(
      {
        kind: 'commands',
        item: { name: 'searchfit-seo:seo-check' },
      }
    )
    expect(
      findPluginItem(sp, { kind: 'hooks', id: 'plugin:superpowers@m:SessionStart-0' })
    ).toMatchObject({ kind: 'hooks', item: { event: 'SessionStart' } })
    expect(findPluginItem(sp, { kind: 'skills', id: 'gone' })).toBeNull()
    expect(findPluginItem(sp, null)).toBeNull()
  })

  it('summarises the item counts', () => {
    expect(pluginItemSummary(views.find((v) => v.source.label === 'superpowers')!)).toBe(
      '1 skill · 1 hook'
    )
    expect(pluginItemSummary(views.find((v) => v.source.label === 'empty')!)).toBe('No items')
  })
})

describe('defaultPluginTab', () => {
  const base = { source: plugin('p'), skills: [], commands: [], hooks: [] }

  it('opens on the first section that has items', () => {
    expect(defaultPluginTab({ ...base, skills: [skill('a', plugin('p'))] })).toBe('skills')
    expect(defaultPluginTab({ ...base, commands: [command('c', plugin('p'))] })).toBe('commands')
    expect(
      defaultPluginTab({
        ...base,
        hooks: [
          {
            event: 'Stop',
            eventGroupId: 'Stop',
            rule: {
              id: 'r',
              matcher: '',
              hooks: [],
              scope: 'plugin',
              sourcePath: '/h.json',
              source: plugin('p'),
            },
          },
        ],
      })
    ).toBe('hooks')
  })

  it('opens on Skills for a plugin with no items', () => {
    expect(defaultPluginTab(base)).toBe('skills')
  })
})
