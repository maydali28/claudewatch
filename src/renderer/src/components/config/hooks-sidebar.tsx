import React, { useState } from 'react'
import { RefreshCw, Search, X, ChevronDown, ChevronRight, Webhook } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { HookEventGroup, HookRule } from '@shared/types'

function hookRuleId(group: HookEventGroup, rule: HookRule): string {
  return `${group.id}::${rule.id}`
}

function CollapsibleGroup({
  label,
  count,
  defaultExpanded = true,
  children,
}: {
  label: string
  count: number
  defaultExpanded?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent/40 rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Webhook className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider truncate flex-1">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground/40 shrink-0">{count}</span>
      </button>
      {expanded && (
        <div className="ml-2 border-l border-border/40 pl-1.5 space-y-0.5">{children}</div>
      )}
    </div>
  )
}

function RuleItem({
  rule,
  selectedId,
  onSelect,
}: {
  rule: { id: string; matcher: string; commandCount: number }
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => onSelect(rule.id)}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        selectedId === rule.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
      )}
    >
      <p
        className={cn(
          'text-xs font-medium font-mono truncate',
          selectedId === rule.id ? 'text-primary' : 'text-foreground'
        )}
      >
        {rule.matcher || '*'}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {rule.commandCount} command{rule.commandCount !== 1 ? 's' : ''}
      </p>
    </button>
  )
}

export default function HooksSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const hooks = useConfigStore((s) => s.hooks)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedHookId = useConfigStore((s) => s.selectedHookId)
  const setSelectedHook = useConfigStore((s) => s.setSelectedHook)
  const [search, setSearch] = useState('')

  const q = search.toLowerCase()

  const filteredGroups = hooks
    .map((g) => ({
      ...g,
      rules: g.rules.filter(
        (r) => g.event.toLowerCase().includes(q) || (r.matcher ?? '').toLowerCase().includes(q)
      ),
    }))
    .filter((g) => g.rules.length > 0)

  const total = hooks.reduce((acc, g) => acc + g.rules.length, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Hooks
          </span>
          {total > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {total}
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
            placeholder="Filter hooks…"
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
        {isLoading && total === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isLoading && total === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Webhook className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No hooks configured</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Add hooks to ~/.claude/settings.json
            </p>
          </div>
        )}

        {!isLoading && total > 0 && filteredGroups.length === 0 && search && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">No matches for &quot;{search}&quot;</p>
          </div>
        )}

        {filteredGroups.map((group) => (
          <CollapsibleGroup key={group.id} label={group.event} count={group.rules.length}>
            {group.rules.map((rule) => {
              const id = hookRuleId(group, rule)
              return (
                <RuleItem
                  key={id}
                  rule={{ id, matcher: rule.matcher, commandCount: rule.hooks.length }}
                  selectedId={selectedHookId}
                  onSelect={setSelectedHook}
                />
              )
            })}
          </CollapsibleGroup>
        ))}
      </div>
    </div>
  )
}
