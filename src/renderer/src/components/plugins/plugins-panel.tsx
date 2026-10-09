import React, { useState } from 'react'
import { ChevronRight, CircleSlash, Info, Layers, Puzzle, Terminal, Webhook } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { pluginTags } from '@renderer/components/config/source-group-decor'
import { relativeDay } from '@renderer/components/config/skill-usage'
import { inactiveReasonText } from '@renderer/components/config/hook-scope-label'
import { SkillDetail } from '@renderer/components/config/skills-panel'
import { CommandDetail } from '@renderer/components/config/commands-panel'
import { HookDetail } from '@renderer/components/config/hooks-panel'
import {
  buildPluginViews,
  defaultPluginTab,
  findPluginItem,
  type PluginItemRef,
  type PluginTab,
  type PluginView,
} from './plugin-views'

/** A plugin item's name without the `<plugin>:` prefix the other tabs show. */
function shortName(name: string, plugin: string): string {
  return name.startsWith(`${plugin}:`) ? name.slice(plugin.length + 1) : name
}

const TABS: Array<{ value: PluginTab; label: string; icon: React.ElementType }> = [
  { value: 'skills', label: 'Skills', icon: Layers },
  { value: 'commands', label: 'Commands', icon: Terminal },
  { value: 'hooks', label: 'Hooks', icon: Webhook },
]

function ItemList({
  empty,
  children,
}: {
  empty: string
  children: React.ReactNode[]
}): React.JSX.Element {
  if (children.length === 0) return <p className="text-xs text-muted-foreground/60">{empty}</p>
  return <ul className="rounded-lg border border-border divide-y divide-border/40">{children}</ul>
}

/** A row that opens the item's full view. */
function ItemRow({
  onOpen,
  label,
  children,
}: {
  onOpen: () => void
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${label}`}
        className="group flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
      >
        <div className="flex-1 min-w-0">{children}</div>
        <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
      </button>
    </li>
  )
}

function originText(view: PluginView): string {
  const plugin = view.source.plugin
  if (!plugin) return ''
  if (plugin.installed === false) return 'No longer installed; known from your sessions'
  if (plugin.origin === 'claude.ai') return 'From your claude.ai account'
  return plugin.marketplace ? `From the ${plugin.marketplace} marketplace` : 'From a marketplace'
}

function PluginHeader({ view }: { view: PluginView }): React.JSX.Element {
  const tags = pluginTags(view.source)
  return (
    <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
      <Puzzle className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {view.source.label}
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
  )
}

function PluginDetail({ view }: { view: PluginView }): React.JSX.Element {
  const label = view.source.label
  const disabled = view.source.plugin?.enabled === false && view.source.plugin.installed !== false
  const [tab, setTab] = useState<PluginTab>(() => defaultPluginTab(view))
  const [opened, setOpened] = useState<PluginItemRef | null>(null)
  const item = findPluginItem(view, opened)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PluginHeader view={view} />

      {/* An item opens in a dialog over the plugin, so its tabs stay where they were. */}
      <Dialog open={item !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="flex h-[85vh] w-[92vw] max-w-4xl flex-col overflow-hidden p-0">
          {item && (
            <>
              <div className="flex items-center gap-2 border-b border-border/50 py-2.5 pl-4 pr-12 text-xs shrink-0">
                <Puzzle className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                <DialogTitle className="text-xs font-medium text-foreground">{label}</DialogTitle>
                <span className="text-muted-foreground/50">/</span>
                <span className="text-muted-foreground">
                  {TABS.find((t) => t.value === item.kind)?.label}
                </span>
              </div>
              <DialogDescription className="sr-only">
                The plugin item in full, as Claude Code loads it
              </DialogDescription>
              <div className="min-h-0 flex-1 overflow-hidden">
                {item.kind === 'skills' && <SkillDetail skill={item.item} />}
                {item.kind === 'commands' && <CommandDetail cmd={item.item} />}
                {item.kind === 'hooks' && (
                  <HookDetail event={item.item.event} rule={item.item.rule} />
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PluginTab)}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-6 pt-4 shrink-0 space-y-3">
          {disabled && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <CircleSlash className="h-3.5 w-3.5 shrink-0" />
              Disabled in your settings: Claude Code loads none of its skills, commands or hooks.
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-muted-foreground/70">
              Select an item to see it in full.
            </p>
            <TabsList>
              {TABS.map(({ value, label: tabLabel, icon: Icon }) => {
                const count = view[value].length
                return (
                  <TabsTrigger key={value} value={value} disabled={count === 0} className="gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {tabLabel}
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>
        </div>

        <TabsContent value="skills" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
          <ItemList empty="No skills">
            {view.skills.map((s) => (
              <ItemRow
                key={s.id}
                label={s.name}
                onOpen={() => setOpened({ kind: 'skills', id: s.id })}
              >
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
              </ItemRow>
            ))}
          </ItemList>
        </TabsContent>

        <TabsContent value="commands" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
          <ItemList empty="No commands">
            {view.commands.map((c) => (
              <ItemRow
                key={c.id}
                label={`/${c.name}`}
                onOpen={() => setOpened({ kind: 'commands', id: c.id })}
              >
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
              </ItemRow>
            ))}
          </ItemList>
        </TabsContent>

        <TabsContent value="hooks" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
          <ItemList empty="No hooks">
            {view.hooks.map(({ event, rule }) => (
              <ItemRow
                key={rule.id}
                label={`${event} ${rule.matcher || '*'}`}
                onOpen={() => setOpened({ kind: 'hooks', id: rule.id })}
              >
                <p className="text-xs font-medium">
                  {event}
                  <span className="ml-2 font-mono text-muted-foreground">
                    {rule.matcher || '*'}
                  </span>
                </p>
                <p
                  className={cn(
                    'text-[11px] font-mono text-muted-foreground mt-0.5 truncate',
                    rule.inactiveReason && 'opacity-70'
                  )}
                >
                  {rule.hooks.map((h) => h.command).join(' · ')}
                </p>
                {rule.inactiveReason && (
                  <p className="flex items-center gap-1 text-[10px] text-muted-foreground/70 mt-0.5">
                    <Info className="h-3 w-3" />
                    {inactiveReasonText(rule.inactiveReason)}
                  </p>
                )}
              </ItemRow>
            ))}
          </ItemList>
        </TabsContent>
      </Tabs>
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
  // Remount per plugin so its tab and open item reset.
  return <PluginDetail key={selected.source.id} view={selected} />
}
