import React, { useState } from 'react'
import { Brain, RefreshCw, Search, X, FolderOpen, Globe, Sparkles } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { SourceChips } from './source-chips'
import {
  countMemoryByKind,
  memoryKindOf,
  type MemoryFilter,
  type MemoryKind,
} from './memory-filter'
import type { ProjectClaudeMd } from '@shared/types/project'

function projectClaudeMdId(entry: ProjectClaudeMd): string {
  return `project-claude-md:${entry.projectId}`
}

const KIND_ICON: Record<MemoryKind, React.ElementType> = {
  global: Globe,
  project: FolderOpen,
  auto: Sparkles,
}

/** One memory file as a card: its name, then where it belongs (Global, a project, Auto memory). */
function MemoryItem({
  id,
  label,
  kind,
  owner,
  sizeBytes,
  selectedId,
  onSelect,
}: {
  id: string
  label: string
  kind: MemoryKind
  owner: string
  sizeBytes?: number
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const Icon = KIND_ICON[kind]
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
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 min-w-0">
        <Icon
          className={cn(
            'h-3 w-3 shrink-0',
            kind === 'project' ? 'text-amber-500' : 'text-muted-foreground/70'
          )}
        />
        <span className="truncate">{owner}</span>
      </p>
      {sizeBytes !== undefined && (
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          {(sizeBytes / 1024).toFixed(1)} KB
        </p>
      )}
    </button>
  )
}

/** The second line of a card for a file `readMemoryFiles` returned. */
function ownerOf(kind: MemoryKind, sublabel: string): string {
  if (kind === 'global') return 'Global'
  if (kind === 'auto') return 'Auto memory'
  return sublabel
}

export default function MemorySidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const memoryFiles = useConfigStore((s) => s.memoryFiles)
  const projectClaudeMds = useConfigStore((s) => s.projectClaudeMds)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedMemoryId = useConfigStore((s) => s.selectedMemoryId)
  const setSelectedMemory = useConfigStore((s) => s.setSelectedMemory)
  const [search, setSearch] = useState('')
  const kindFilter = (useUIStore((s) => s.sourceFilters.memory) ?? 'all') as MemoryFilter
  const setSourceFilter = useUIStore((s) => s.setSourceFilter)

  const q = search.toLowerCase()

  const searchedFiles = memoryFiles.filter(
    (f) => f.label.toLowerCase().includes(q) || f.sublabel.toLowerCase().includes(q)
  )
  const searchedProjectMds = projectClaudeMds.filter(
    (p) => p.projectName.toLowerCase().includes(q) || 'claude.md'.includes(q)
  )
  const counts = countMemoryByKind(searchedFiles, searchedProjectMds.length)

  const filteredFiles = searchedFiles.filter(
    (f) => kindFilter === 'all' || memoryKindOf(f) === kindFilter
  )
  const filteredProjectMds =
    kindFilter === 'all' || kindFilter === 'project' ? searchedProjectMds : []

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
          filteredProjectMds.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-3">
              <p className="text-xs text-muted-foreground">
                {search ? <>No matches for &quot;{search}&quot;</> : 'No memory files of this kind'}
              </p>
            </div>
          )}

        {filteredFiles.map((file) => {
          const kind = memoryKindOf(file)
          return (
            <MemoryItem
              key={file.id}
              id={file.id}
              label={file.label}
              kind={kind}
              owner={ownerOf(kind, file.sublabel)}
              sizeBytes={file.sizeBytes}
              selectedId={selectedMemoryId}
              onSelect={setSelectedMemory}
            />
          )
        })}

        {[...filteredProjectMds]
          .sort((a, b) => a.projectName.toLowerCase().localeCompare(b.projectName.toLowerCase()))
          .map((p) => (
            <MemoryItem
              key={p.projectId}
              id={projectClaudeMdId(p)}
              label="CLAUDE.md"
              kind="project"
              owner={p.projectName}
              sizeBytes={p.sizeBytes}
              selectedId={selectedMemoryId}
              onSelect={setSelectedMemory}
            />
          ))}
      </div>
    </div>
  )
}
