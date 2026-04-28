import React, { useState } from 'react'
import { RefreshCw, Search, Terminal, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { Skeleton } from '@renderer/components/ui/skeleton'

export default function CommandsSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const commands = useConfigStore((s) => s.commands)
  const selectedCommandId = useConfigStore((s) => s.selectedCommandId)
  const setSelectedCommand = useConfigStore((s) => s.setSelectedCommand)
  const loadAll = useConfigStore((s) => s.loadAll)
  const [search, setSearch] = useState('')

  const filtered = commands.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Commands
          </span>
          {commands.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {commands.length}
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
            placeholder="Filter commands…"
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

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading && commands.length === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isLoading && commands.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Terminal className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No commands found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Add .md files to ~/.claude/commands/
            </p>
          </div>
        )}

        {!isLoading && commands.length > 0 && filtered.length === 0 && search && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">No matches for &quot;{search}&quot;</p>
          </div>
        )}

        {filtered.map((cmd) => (
          <button
            key={cmd.id}
            onClick={() => setSelectedCommand(cmd.id)}
            className={cn(
              'w-full rounded-md px-2.5 py-2 text-left transition-colors',
              selectedCommandId === cmd.id
                ? 'bg-primary/10 ring-1 ring-primary/30'
                : 'hover:bg-accent'
            )}
          >
            <p
              className={cn(
                'text-xs font-medium truncate',
                selectedCommandId === cmd.id ? 'text-primary' : 'text-foreground'
              )}
            >
              /{cmd.name}
            </p>
            {cmd.description && (
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{cmd.description}</p>
            )}
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">
              {(cmd.sizeBytes / 1024).toFixed(1)} KB
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
