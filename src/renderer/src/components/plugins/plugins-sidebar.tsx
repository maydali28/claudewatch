import React, { useState } from 'react'
import { Puzzle, RefreshCw, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { pluginTags } from '@renderer/components/config/source-group-decor'
import { buildPluginViews, pluginItemSummary } from './plugin-views'

export default function PluginsSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const plugins = useConfigStore((s) => s.plugins)
  const skills = useConfigStore((s) => s.skills)
  const commands = useConfigStore((s) => s.commands)
  const hooks = useConfigStore((s) => s.hooks)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedPluginId = useConfigStore((s) => s.selectedPluginId)
  const setSelectedPlugin = useConfigStore((s) => s.setSelectedPlugin)
  const [search, setSearch] = useState('')

  const views = buildPluginViews(plugins, skills, commands, hooks)
  // The panel shows the first plugin until one is chosen; highlight the same one.
  const selectedId = views.some((v) => v.source.id === selectedPluginId)
    ? selectedPluginId
    : (views[0]?.source.id ?? null)
  const q = search.toLowerCase()
  const filtered = views.filter(
    (v) =>
      v.source.label.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q)
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Plugins
          </span>
          {views.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {views.length}
            </span>
          )}
        </div>
        <button
          onClick={() => loadAll()}
          disabled={isLoading}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 text-muted-foreground', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter plugins…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && views.length === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}

        {!isLoading && views.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Puzzle className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No plugins installed</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Install one in Claude Code with /plugin
            </p>
          </div>
        )}

        {!isLoading && views.length > 0 && filtered.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-xs text-muted-foreground">No plugins match &quot;{search}&quot;</p>
          </div>
        )}

        {filtered.map((v) => {
          const selected = selectedId === v.source.id
          const tags = pluginTags(v.source)
          const off = v.source.plugin?.enabled === false
          return (
            <button
              key={v.source.id}
              onClick={() => setSelectedPlugin(v.source.id)}
              className={cn(
                'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent',
                off && 'opacity-60'
              )}
            >
              <p className="flex items-center gap-1.5 min-w-0">
                <Puzzle
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    selected ? 'text-primary' : 'text-violet-500'
                  )}
                />
                <span
                  className={cn(
                    'text-xs font-medium truncate',
                    selected ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {v.source.label}
                </span>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </p>
              {v.description && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{v.description}</p>
              )}
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">{pluginItemSummary(v)}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
