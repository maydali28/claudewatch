import React, { useState } from 'react'
import { Terminal, Copy, Check } from 'lucide-react'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { CommandEntry } from '@shared/types'

// ─── Command detail view ──────────────────────────────────────────────────────

function CommandDetail({ cmd }: { cmd: CommandEntry }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  function handleCopy(): void {
    navigator.clipboard.writeText(cmd.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Terminal className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">/{cmd.name}</h2>
          {cmd.description && (
            <p className="text-xs text-muted-foreground mt-1">{cmd.description}</p>
          )}
          <p className="text-[10px] text-muted-foreground/50 mt-1">
            {(cmd.sizeBytes / 1024).toFixed(1)} KB
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="p-2 rounded-md hover:bg-accent transition-colors shrink-0"
          title="Copy content"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed bg-muted/30 rounded-lg p-4">
          {cmd.content}
        </pre>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function CommandsPanel(): React.JSX.Element {
  const { commands, selectedCommandId } = useConfigStore()
  const selected = commands.find((c) => c.id === selectedCommandId) ?? null

  if (!selected)
    return (
      <EmptyState
        icon={Terminal}
        title="No command selected"
        description="Choose a command from the sidebar to view its content"
      />
    )
  return <CommandDetail cmd={selected} />
}
