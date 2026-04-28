import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

interface ThinkingBlockProps {
  thinking: string
  className?: string
}

export default function ThinkingBlock({
  thinking,
  className,
}: ThinkingBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn('rounded-md border border-border/50 bg-muted/30 text-xs', className)}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain className="h-3 w-3 shrink-0 text-violet-500" />
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-medium">Thinking</span>
        {!expanded && (
          <span className="ml-auto text-muted-foreground/70">
            {thinking.length.toLocaleString()} chars
          </span>
        )}
      </button>
      {expanded && (
        <pre className="overflow-x-auto px-3 pb-3 pt-0 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed border-t border-border/50">
          {thinking}
        </pre>
      )}
    </div>
  )
}
