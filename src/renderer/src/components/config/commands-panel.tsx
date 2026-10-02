import React, { useState } from 'react'
import { Terminal, Copy, Check, CircleSlash } from 'lucide-react'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { CommandEntry } from '@shared/types'
import MarkdownBody from '@renderer/components/shared/markdown-body'
import { pluginTags } from './source-group-decor'

/** "user" | "<project> · project" | "<plugin> · plugin (tags)" */
function commandSourceLabel(cmd: CommandEntry): string {
  switch (cmd.scope) {
    case 'user':
      return 'user'
    case 'project':
      return cmd.projectName ? `${cmd.projectName} · project` : 'project'
    case 'plugin': {
      const tags = pluginTags(cmd.source)
      return `${cmd.source.label} · plugin${tags.length > 0 ? ` (${tags.join(', ')})` : ''}`
    }
  }
}

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
          <p className="text-[10px] text-muted-foreground mt-1">
            {commandSourceLabel(cmd)} · {(cmd.sizeBytes / 1024).toFixed(1)} KB
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate" title={cmd.filePath}>
            {cmd.filePath}
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

      {/* Body: frontmatter is already stripped by the config service, so this
          is the prompt itself — markdown, like a skill body. */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {cmd.inactive && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <CircleSlash className="h-3.5 w-3.5 shrink-0" />
            Not available: the plugin is disabled
          </div>
        )}
        {cmd.arguments && cmd.arguments.length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
              Arguments
            </p>
            <ul className="space-y-1">
              {cmd.arguments.map((arg) => (
                <li key={arg.name} className="text-xs">
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{arg.name}</code>
                  {arg.required && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">required</span>
                  )}
                  {arg.description && (
                    <span className="ml-2 text-muted-foreground">{arg.description}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <MarkdownBody content={cmd.content} label="Body" />
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
