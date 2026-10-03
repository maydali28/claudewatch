import React, { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Folder, Globe, RefreshCw, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { SourceChips } from './source-chips'
import { countMemoryByKind, memoryKindOf, type MemoryFilter } from './memory-filter'
import { buildMemoryOwners, visibleMemoryOwners, type MemoryOwner } from './memory-owners'
import { relativeDay } from './skill-usage'
import type { MemoryFile } from '@shared/types'

const KIND_TAG = { global: 'global', project: 'project', auto: 'auto memory' } as const

/** A memory file's name as listed: notes keep their `.md`, like CLAUDE.md. */
export function memoryFileName(file: MemoryFile): string {
  return memoryKindOf(file) === 'auto' ? `${file.label}.md` : file.label
}

/** One file, as a card like a session's: name and size, then kind and last change. */
function MemoryFileItem({
  file,
  isActive,
  onClick,
}: {
  file: MemoryFile
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  const kind = memoryKindOf(file)
  const isIndex = kind === 'auto' && file.label === 'MEMORY'
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
      )}
    >
      <p className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn(
            'text-xs font-medium truncate flex-1',
            isActive ? 'text-primary' : 'text-foreground'
          )}
        >
          {memoryFileName(file)}
        </span>
        {file.sizeBytes !== undefined && (
          <span className="text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
            {(file.sizeBytes / 1024).toFixed(1)} KB
          </span>
        )}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {isIndex ? 'index' : KIND_TAG[kind]}
        {file.modifiedAt && <> · {relativeDay(file.modifiedAt)}</>}
      </p>
    </button>
  )
}

/** An owner as a folder, like a project in the Sessions list. */
function MemoryOwnerTree({
  owner,
  activeFileId,
  onSelectFile,
}: {
  owner: MemoryOwner
  activeFileId: string | null
  onSelectFile: (id: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={owner.label}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md hover:bg-accent/40 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {owner.kind === 'global' ? (
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        )}
        {/* Cut a long name at its start: folder names of projects without
            transcripts share a long prefix and differ at the end. */}
        <span className="truncate flex-1 text-foreground [direction:rtl] text-left">
          <span className="[direction:ltr] [unicode-bidi:embed]">{owner.label}</span>
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
          {owner.files.length}
        </span>
      </button>

      {expanded && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-border/40 pl-2">
          {owner.files.map((file) => (
            <MemoryFileItem
              key={file.id}
              file={file}
              isActive={file.id === activeFileId}
              onClick={() => onSelectFile(file.id)}
            />
          ))}
        </div>
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
  const kindFilter = (useUIStore((s) => s.sourceFilters.memory) ?? 'all') as MemoryFilter
  const setSourceFilter = useUIStore((s) => s.setSourceFilter)

  const owners = buildMemoryOwners(memoryFiles, projectClaudeMds)
  const counts = countMemoryByKind(
    visibleMemoryOwners(owners, 'all', search).flatMap((o) => o.files),
    0
  )
  const visible = visibleMemoryOwners(owners, kindFilter, search)
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
            placeholder="Search projects or files…"
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

        {!isLoading && total > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">
              {search ? <>No matches for &quot;{search}&quot;</> : 'No memory files of this kind'}
            </p>
          </div>
        )}

        {visible.map((owner) => (
          <MemoryOwnerTree
            key={owner.id}
            owner={owner}
            activeFileId={selectedMemoryId}
            onSelectFile={setSelectedMemory}
          />
        ))}
      </div>
    </div>
  )
}
