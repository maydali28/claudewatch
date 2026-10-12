import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

/**
 * A collapsible group header (chevron, optional icon, label, count) used at
 * the top of the Skills, Memory, Hooks, Commands and Plans sidebars for the
 * "Global" group and each per-project group, and by the Hooks sidebar again
 * for its nested per-event sub-groups.
 */
export function ScopeGroup({
  label,
  count,
  icon,
  defaultExpanded = true,
  title,
  paths,
  tags,
  muted = false,
  children,
}: {
  label: string
  count: number
  icon?: React.ReactNode
  defaultExpanded?: boolean
  /** Set on the header button, e.g. to surface a directory path on hover. */
  title?: string
  /** Paths shown under the header, one per line, e.g. the folders the group's items live in. */
  paths?: string[]
  /** Small tags after the label, e.g. a plugin's version, "claude.ai" or "disabled". */
  tags?: string[]
  /** Dims the header, e.g. for a disabled plugin. */
  muted?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={title}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent/40 rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {icon}
        <span
          className={cn(
            'text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider truncate',
            !tags?.length && 'flex-1',
            muted && 'opacity-60'
          )}
        >
          {label}
        </span>
        {tags && tags.length > 0 && (
          <span className="flex flex-1 min-w-0 items-center gap-1 overflow-hidden">
            {tags.map((tag) => (
              <span
                key={tag}
                className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/40 shrink-0">{count}</span>
      </button>
      {paths && paths.length > 0 && (
        <div className="pl-[1.375rem] pr-2 -mt-1 pb-1">
          {paths.map((p) => (
            // Right-to-left box with a left-to-right span inside: a long path
            // is cut at its start, so the meaningful end stays visible.
            <div
              key={p}
              className="text-[10px] text-muted-foreground/60 font-mono truncate [direction:rtl] text-left"
              title={p}
            >
              <span className="[direction:ltr] [unicode-bidi:embed]">{p}</span>
            </div>
          ))}
        </div>
      )}
      {expanded && (
        <div className="ml-2 border-l border-border/40 pl-1.5 space-y-0.5">{children}</div>
      )}
    </div>
  )
}
