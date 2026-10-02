import React from 'react'
import { CircleSlash, Info, Layers, Puzzle, Terminal, Webhook } from 'lucide-react'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { pluginTags } from '@renderer/components/config/source-group-decor'
import { relativeDay } from '@renderer/components/config/skill-usage'
import { inactiveReasonText } from '@renderer/components/config/hook-scope-label'
import { buildPluginViews, type PluginView } from './plugin-views'

/** A plugin item's name without the `<plugin>:` prefix the other tabs show. */
function shortName(name: string, plugin: string): string {
  return name.startsWith(`${plugin}:`) ? name.slice(plugin.length + 1) : name
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ElementType
  title: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
        <Icon className="h-3.5 w-3.5" />
        {title}
        <span className="text-muted-foreground/50">{count}</span>
      </p>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground/60">None</p>
      ) : (
        <ul className="rounded-lg border border-border divide-y divide-border/40">{children}</ul>
      )}
    </section>
  )
}

function originText(view: PluginView): string {
  const plugin = view.source.plugin
  if (!plugin) return ''
  if (plugin.installed === false) return 'No longer installed; known from your sessions'
  if (plugin.origin === 'claude.ai') return 'From your claude.ai account'
  return plugin.marketplace ? `From the ${plugin.marketplace} marketplace` : 'From a marketplace'
}

function PluginDetail({ view }: { view: PluginView }): React.JSX.Element {
  const label = view.source.label
  const tags = pluginTags(view.source)
  const disabled = view.source.plugin?.enabled === false && view.source.plugin.installed !== false

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Puzzle className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {label}
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </h2>
          {view.description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{view.description}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            {originText(view)}
            {view.author && <> · by {view.author}</>}
            {view.homepage && (
              <>
                {' '}
                ·{' '}
                <a
                  href={view.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  homepage
                </a>
              </>
            )}
          </p>
          {view.source.root && (
            <p
              className="text-[10px] text-muted-foreground/50 mt-0.5 truncate font-mono"
              title={view.source.root}
            >
              {view.source.root}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {disabled && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <CircleSlash className="h-3.5 w-3.5 shrink-0" />
            Disabled in your settings: Claude Code loads none of its skills, commands or hooks.
          </div>
        )}

        <Section icon={Layers} title="Skills" count={view.skills.length}>
          {view.skills.map((s) => (
            <li key={s.id} className="px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-medium">
                {shortName(s.name, label)}
                {s.sessionOnly && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                    {s.exposedAs === 'command' ? 'command' : 'no file'}
                  </span>
                )}
              </p>
              {s.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {s.description}
                </p>
              )}
              {s.lastSeen && (
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  seen {relativeDay(s.lastSeen)} in {s.sessionCount ?? 0} session
                  {s.sessionCount === 1 ? '' : 's'}
                </p>
              )}
            </li>
          ))}
        </Section>

        <Section icon={Terminal} title="Commands" count={view.commands.length}>
          {view.commands.map((c) => (
            <li key={c.id} className="px-3 py-2">
              <p className="text-xs font-medium font-mono">/{c.name}</p>
              {c.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {c.description}
                </p>
              )}
              {c.arguments && c.arguments.length > 0 && (
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">
                  {c.arguments.map((a) => (a.required ? a.name : `[${a.name}]`)).join(' ')}
                </p>
              )}
            </li>
          ))}
        </Section>

        <Section icon={Webhook} title="Hooks" count={view.hooks.length}>
          {view.hooks.map(({ event, rule }) => (
            <li key={rule.id} className="px-3 py-2 space-y-1">
              <p className="text-xs font-medium">
                {event}
                <span className="ml-2 font-mono text-muted-foreground">{rule.matcher || '*'}</span>
              </p>
              {rule.hooks.map((h, i) => (
                <pre
                  key={i}
                  className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all"
                >
                  {h.command}
                </pre>
              ))}
              {rule.inactiveReason && (
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                  <Info className="h-3 w-3" />
                  {inactiveReasonText(rule.inactiveReason)}
                </p>
              )}
            </li>
          ))}
        </Section>
      </div>
    </div>
  )
}

export default function PluginsPanel(): React.JSX.Element {
  const { plugins, skills, commands, hooks, selectedPluginId } = useConfigStore()
  const views = buildPluginViews(plugins, skills, commands, hooks)
  const selected = views.find((v) => v.source.id === selectedPluginId) ?? views[0] ?? null

  if (!selected)
    return (
      <EmptyState
        icon={Puzzle}
        title="No plugins"
        description="Plugins you install in Claude Code appear here with their skills, commands and hooks"
      />
    )
  return <PluginDetail view={selected} />
}
