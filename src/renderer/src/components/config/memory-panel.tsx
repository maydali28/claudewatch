import React from 'react'
import {
  ArrowLeft,
  Brain,
  ChevronRight,
  Code,
  Eye,
  FolderOpen,
  Globe,
  Sparkles,
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { MemoryFile } from '@shared/types'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { memoryContentState, memoryKindOf, type MemoryFilter } from './memory-filter'
import {
  buildMemoryOwners,
  memoryOwnerSummary,
  visibleMemoryOwners,
  type MemoryOwner,
} from './memory-owners'

// ─── Content section with raw / preview toggle ────────────────────────────────

function ContentSection({ content }: { content: string }): React.JSX.Element {
  const [mode, setMode] = React.useState<'preview' | 'raw'>('preview')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-end px-6 py-2 border-b border-border/30 shrink-0">
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setMode('preview')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
              mode === 'preview'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={() => setMode('raw')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors border-l border-border',
              mode === 'raw'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <Code className="h-3 w-3" />
            Raw
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {mode === 'preview' ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <pre className="rounded-lg border border-border bg-muted/40 p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}

// ─── Memory file detail view ──────────────────────────────────────────────────

function MemoryDetail({ file }: { file: MemoryFile }): React.JSX.Element {
  const lineCount = file.content?.split('\n').length ?? 0
  const state = memoryContentState(file.content)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Brain className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">{file.label}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{fileOwnerText(file)}</p>
          <p
            className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono truncate"
            title={file.path}
          >
            {file.path}
          </p>
          <div className="flex items-center gap-3 mt-1">
            {file.sizeBytes !== undefined && (
              <span className="text-[10px] text-muted-foreground/60">
                {(file.sizeBytes / 1024).toFixed(1)} KB
              </span>
            )}
            {state === 'present' && (
              <span className="text-[10px] text-muted-foreground/60">{lineCount} lines</span>
            )}
          </div>
        </div>
      </div>

      {/* Content, an empty file, or one that could not be read */}
      {state === 'present' ? (
        <ContentSection content={file.content ?? ''} />
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-1 px-6">
          <p className="text-xs text-muted-foreground">
            {state === 'empty' ? 'This file is empty' : 'Content not available'}
          </p>
          <p className="text-[10px] text-muted-foreground/60 font-mono break-all">{file.path}</p>
        </div>
      )}
    </div>
  )
}

/** Where a file belongs, for its header: Global, the project, or the project's auto memory. */
function fileOwnerText(file: MemoryFile): string {
  switch (memoryKindOf(file)) {
    case 'global':
      return 'Global'
    case 'auto':
      return file.projectName ? `${file.projectName} · auto memory` : 'Auto memory'
    case 'project':
      return file.projectName ? `${file.projectName} · project` : 'project'
  }
}

/** A file's name as listed: notes are shown with their `.md`, like CLAUDE.md. */
function fileName(file: MemoryFile): string {
  return memoryKindOf(file) === 'auto' ? `${file.label}.md` : file.label
}

const KIND_ICON = { global: Globe, project: FolderOpen, auto: Sparkles } as const
const KIND_TAG = { global: 'global', project: 'CLAUDE.md', auto: 'auto memory' } as const

// ─── One owner's files ────────────────────────────────────────────────────────

function OwnerView({
  owner,
  onOpen,
}: {
  owner: MemoryOwner
  onOpen: (id: string) => void
}): React.JSX.Element {
  const memoryDir = owner.files.find((f) => memoryKindOf(f) === 'auto')?.path
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        {owner.kind === 'global' ? (
          <Globe className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <FolderOpen className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{owner.label}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{memoryOwnerSummary(owner)}</p>
          {memoryDir && (
            <p
              className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono truncate"
              title={memoryDir.replace(/\/[^/]+$/, '')}
            >
              {memoryDir.replace(/\/[^/]+$/, '')}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <ul className="rounded-lg border border-border divide-y divide-border/40">
          {owner.files.map((file) => {
            const kind = memoryKindOf(file)
            const Icon = KIND_ICON[kind]
            return (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onOpen(file.id)}
                  aria-label={`Open ${fileName(file)}`}
                  className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      kind === 'project' ? 'text-amber-500' : 'text-muted-foreground'
                    )}
                  />
                  <span className="flex-1 min-w-0 truncate text-xs font-medium">
                    {fileName(file)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">
                    {KIND_TAG[kind]}
                  </span>
                  {file.sizeBytes !== undefined && (
                    <span className="w-14 text-right text-[10px] tabular-nums text-muted-foreground/50 shrink-0">
                      {(file.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function MemoryPanel(): React.JSX.Element {
  const {
    memoryFiles,
    projectClaudeMds,
    selectedMemoryId,
    selectedMemoryOwnerId,
    setSelectedMemory,
  } = useConfigStore()
  const kindFilter = (useUIStore((s) => s.sourceFilters.memory) ?? 'all') as MemoryFilter

  // Same owners, in the same order, as the sidebar; search is the sidebar's own.
  const owners = visibleMemoryOwners(
    buildMemoryOwners(memoryFiles, projectClaudeMds),
    kindFilter,
    ''
  )
  const owner = owners.find((o) => o.id === selectedMemoryOwnerId) ?? owners[0] ?? null

  if (!owner)
    return (
      <EmptyState
        icon={Brain}
        title="No memory files"
        description="Nothing to show for this filter. Switch it back to All to see every memory file."
      />
    )

  // An open file, while it is still one of the owner's files under the filter.
  const file = owner.files.find((f) => f.id === selectedMemoryId)
  if (!file) return <OwnerView owner={owner} onOpen={setSelectedMemory} />

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 shrink-0 text-xs">
        <button
          type="button"
          onClick={() => setSelectedMemory(null)}
          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {owner.label}
        </button>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-muted-foreground truncate">{fileName(file)}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <MemoryDetail file={file} />
      </div>
    </div>
  )
}
