import React from 'react'
import { Brain, Eye, Code } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { MemoryFile } from '@shared/types'
import type { ProjectClaudeMd } from '@shared/types/project'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Brain className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">{file.label}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{file.sublabel}</p>
          <div className="flex items-center gap-3 mt-1">
            {file.sizeBytes !== undefined && (
              <span className="text-[10px] text-muted-foreground/60">
                {(file.sizeBytes / 1024).toFixed(1)} KB
              </span>
            )}
            {file.content && (
              <span className="text-[10px] text-muted-foreground/60">{lineCount} lines</span>
            )}
          </div>
        </div>
      </div>

      {/* Content or unavailable */}
      {file.content ? (
        <ContentSection content={file.content} />
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-2">
          <p className="text-xs text-muted-foreground">Content not available</p>
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

function projectClaudeMdToMemoryFile(p: ProjectClaudeMd): MemoryFile {
  return {
    id: `project-claude-md:${p.projectId}`,
    label: 'CLAUDE.md',
    sublabel: p.projectName,
    path: p.filePath,
    content: p.content,
    sizeBytes: p.sizeBytes,
  }
}

export default function MemoryPanel(): React.JSX.Element {
  const { memoryFiles, projectClaudeMds, selectedMemoryId } = useConfigStore()

  const selected =
    memoryFiles.find((f) => f.id === selectedMemoryId) ??
    (selectedMemoryId?.startsWith('project-claude-md:')
      ? (projectClaudeMds.map(projectClaudeMdToMemoryFile).find((f) => f.id === selectedMemoryId) ??
        null)
      : null)

  if (!selected)
    return (
      <EmptyState
        icon={Brain}
        title="No memory file selected"
        description="Choose a memory file from the sidebar to view its content"
      />
    )
  return <MemoryDetail file={selected} />
}
