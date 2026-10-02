import type {
  CommandEntry,
  ConfigSource,
  HookEventGroup,
  HookRule,
  PluginEntry,
  SkillEntry,
} from '@shared/types'

/** Plugin items live in the Plugins tab; the Skills, Commands and Hooks tabs leave them out. */
export function isPluginSourced(source: ConfigSource | undefined): boolean {
  return source?.kind === 'plugin'
}

export interface PluginHook {
  event: string
  /** The event group's id, for the Hooks tab's `<group>::<rule>` selection id. */
  eventGroupId: string
  rule: HookRule
}

export interface PluginView {
  source: ConfigSource
  description?: string
  author?: string
  homepage?: string
  skills: SkillEntry[]
  commands: CommandEntry[]
  hooks: PluginHook[]
}

/**
 * One view per plugin: every installed plugin, plus plugins known only from
 * session skill listings (the claude.ai account's skills, a plugin since
 * removed), each with its skills, commands and hooks. Sorted by name.
 */
export function buildPluginViews(
  plugins: PluginEntry[],
  skills: SkillEntry[],
  commands: CommandEntry[],
  hooks: HookEventGroup[]
): PluginView[] {
  const views = new Map<string, PluginView>()
  const viewFor = (source: ConfigSource): PluginView => {
    let view = views.get(source.id)
    if (!view) {
      view = { source, skills: [], commands: [], hooks: [] }
      views.set(source.id, view)
    }
    return view
  }

  for (const p of plugins) Object.assign(viewFor(p.source), { ...p, source: p.source })
  for (const s of skills)
    if (s.source && isPluginSourced(s.source)) viewFor(s.source).skills.push(s)
  for (const c of commands) if (isPluginSourced(c.source)) viewFor(c.source).commands.push(c)
  for (const g of hooks) {
    for (const rule of g.rules) {
      if (isPluginSourced(rule.source)) {
        viewFor(rule.source).hooks.push({ event: g.event, eventGroupId: g.id, rule })
      }
    }
  }

  return [...views.values()].sort((a, b) =>
    a.source.label.toLowerCase().localeCompare(b.source.label.toLowerCase())
  )
}

function count(n: number, noun: string): string | null {
  return n > 0 ? `${n} ${noun}${n === 1 ? '' : 's'}` : null
}

/** "15 skills · 1 hook", or "No items". */
export function pluginItemSummary(view: PluginView): string {
  const parts = [
    count(view.skills.length, 'skill'),
    count(view.commands.length, 'command'),
    count(view.hooks.length, 'hook'),
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : 'No items'
}
