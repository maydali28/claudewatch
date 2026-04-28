import React, { useState } from 'react'
import { Brain, RefreshCw, Search, X, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { ProjectClaudeMd } from '@shared/types/project'

function projectClaudeMdId(entry: ProjectClaudeMd): string {
  return `project-claude-md:${entry.projectId}`
}

function MemoryItem({
  id,
  label,
  sublabel,
  sizeBytes,
  selectedId,
  onSelect,
}: {
  id: string
  label: string
  sublabel: string
  sizeBytes?: number
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        selectedId === id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
      )}
    >
      <p
        className={cn(
          'text-xs font-medium truncate',
          selectedId === id ? 'text-primary' : 'text-foreground'
        )}
      >
        {label}
      </p>
      {sublabel && <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>}
      {sizeBytes !== undefined && (
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          {(sizeBytes / 1024).toFixed(1)} KB
        </p>
      )}
    </button>
  )
}

function CollapsibleGroup({
  label,
  count,
  icon,
  defaultExpanded = true,
  children,
}: {
  label: string
  count: number
  icon?: React.ReactNode
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
        {icon}
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

export default function MemorySidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const memoryFiles = useConfigStore((s) => s.memoryFiles)
  const projectClaudeMds = useConfigStore((s) => s.projectClaudeMds)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedMemoryId = useConfigStore((s) => s.selectedMemoryId)
  const setSelectedMemory = useConfigStore((s) => s.setSelectedMemory)
  const [search, setSearch] = useState('')

  const q = search.toLowerCase()

  const filteredFiles = memoryFiles.filter(
    (f) => f.label.toLowerCase().includes(q) || f.sublabel.toLowerCase().includes(q)
  )

  const filteredProjectMds = projectClaudeMds.filter(
    (p) => p.projectName.toLowerCase().includes(q) || 'claude.md'.includes(q)
  )

  const total = memoryFiles.length + projectClaudeMds.length

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
            placeholder="Filter memory files…"
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
            <Brain className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No memory files found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Edit ~/.claude/CLAUDE.md to add global memory
            </p>
          </div>
        )}

        {!isLoading &&
          total > 0 &&
          filteredFiles.length === 0 &&
          filteredProjectMds.length === 0 &&
          search && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-3">
              <p className="text-xs text-muted-foreground">No matches for &quot;{search}&quot;</p>
            </div>
          )}

        {filteredFiles.length > 0 && (
          <CollapsibleGroup label="Claude Memory" count={filteredFiles.length}>
            {filteredFiles.map((file) => (
              <MemoryItem
                key={file.id}
                id={file.id}
                label={file.label}
                sublabel={file.sublabel}
                sizeBytes={file.sizeBytes}
                selectedId={selectedMemoryId}
                onSelect={setSelectedMemory}
              />
            ))}
          </CollapsibleGroup>
        )}

        {filteredProjectMds.map((p) => (
          <CollapsibleGroup
            key={p.projectId}
            label={p.projectName}
            count={1}
            icon={<FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          >
            <MemoryItem
              id={projectClaudeMdId(p)}
              label="CLAUDE.md"
              sublabel=""
              sizeBytes={p.sizeBytes}
              selectedId={selectedMemoryId}
              onSelect={setSelectedMemory}
            />
          </CollapsibleGroup>
        ))}
      </div>
    </div>
  )
}
