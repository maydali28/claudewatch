import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import CollapsibleText from './collapsible-text'

interface ThinkingBlockProps {
  thinking: string
  /** The in-session search matched this text: open, and keep the long body open too. */
  forceOpen?: boolean
  className?: string
}

export default function ThinkingBlock({
  thinking,
  forceOpen = false,
  className,
}: ThinkingBlockProps): React.JSX.Element {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const expanded = chosen ?? forceOpen

  return (
    <div className={cn('rounded-md border border-border/50 bg-muted/30 text-xs', className)}>
      <button
        onClick={() => setChosen(!expanded)}
        aria-expanded={expanded}
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
        <CollapsibleText forceOpen={forceOpen} className="px-3 pb-3 border-t border-border/50">
          <pre className="overflow-x-auto pt-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
            {thinking}
          </pre>
        </CollapsibleText>
      )}
    </div>
  )
}
