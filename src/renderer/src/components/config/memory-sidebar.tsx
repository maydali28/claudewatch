import React, { useState } from 'react'
import { Brain, FolderOpen, Globe, RefreshCw, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { SourceChips } from './source-chips'
import { countMemoryByKind, type MemoryFilter } from './memory-filter'
import { buildMemoryOwners, memoryOwnerSummary, visibleMemoryOwners } from './memory-owners'

export default function MemorySidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const memoryFiles = useConfigStore((s) => s.memoryFiles)
  const projectClaudeMds = useConfigStore((s) => s.projectClaudeMds)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedOwnerId = useConfigStore((s) => s.selectedMemoryOwnerId)
  const setSelectedOwner = useConfigStore((s) => s.setSelectedMemoryOwner)
  const [search, setSearch] = useState('')
  const kindFilter = (useUIStore((s) => s.sourceFilters.memory) ?? 'all') as MemoryFilter
  const setSourceFilter = useUIStore((s) => s.setSourceFilter)

  const owners = buildMemoryOwners(memoryFiles, projectClaudeMds)
  const searched = visibleMemoryOwners(owners, 'all', search)
  const counts = countMemoryByKind(
    searched.flatMap((o) => o.files),
    0
  )
  const visible = visibleMemoryOwners(owners, kindFilter, search)
  // The panel shows the first owner until one is chosen; highlight the same one.
  const activeId = visible.some((o) => o.id === selectedOwnerId)
    ? selectedOwnerId
    : (visible[0]?.id ?? null)
  const total = owners.reduce((n, o) => n + o.files.length, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Memory
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
            placeholder="Filter projects or files…"
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

      {total > 0 && (
        <SourceChips<MemoryFilter>
          label="Filter memory files by kind"
          value={kindFilter}
          onChange={(v) => setSourceFilter('memory', v)}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'global', label: 'Global', count: counts.global },
            { value: 'project', label: 'Project', count: counts.project },
            { value: 'auto', label: 'Auto memory', count: counts.auto },
          ]}
        />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading && total === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isLoading && total === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Brain className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No memory files found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Edit ~/.claude/CLAUDE.md to add global memory
            </p>
          </div>
        )}

        {!isLoading && total > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">
              {search ? <>No matches for &quot;{search}&quot;</> : 'No memory files of this kind'}
            </p>
          </div>
        )}

        {visible.map((owner) => {
          const selected = owner.id === activeId
          const Icon = owner.kind === 'global' ? Globe : FolderOpen
          return (
            <button
              key={owner.id}
              onClick={() => setSelectedOwner(owner.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
              )}
            >
              <Icon
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  owner.kind === 'project' ? 'text-amber-500' : 'text-muted-foreground'
                )}
              />
              <span className="flex-1 min-w-0">
                <span
                  // Cut a long name at its start: folder names of projects
                  // without transcripts share a long prefix and differ at the end.
                  className={cn(
                    'block text-xs font-medium truncate [direction:rtl] text-left',
                    selected ? 'text-primary' : 'text-foreground'
                  )}
                  title={owner.label}
                >
                  <span className="[direction:ltr] [unicode-bidi:embed]">{owner.label}</span>
                </span>
                <span className="block text-[10px] text-muted-foreground/70 truncate">
                  {memoryOwnerSummary(owner)}
                </span>
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/50 shrink-0">
                {owner.files.length}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
