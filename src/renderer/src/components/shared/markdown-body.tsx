import React, { useState } from 'react'
import { Code, Eye } from 'lucide-react'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { cn } from '@renderer/lib/cn'
import { lineCount } from './markdown-body-rules'

type BodyMode = 'preview' | 'raw'

interface MarkdownBodyProps {
  content: string
  /** Heading word: "Body" for a skill or command, "Content" for a plan. */
  label: string
  /**
   * `inline`: a titled card inside an already-scrolling page (skills).
   * `panel`: fills its column with a sub-header and its own scroll area
   * (plans, commands).
   */
  layout: 'inline' | 'panel'
}

/**
 * A markdown body with a "{label} (N lines)" heading and a Preview / Raw
 * toggle. One component for skills, plans and commands, so the three read
 * the same and the toggle is built once.
 */
export default function MarkdownBody({
  content,
  label,
  layout,
}: MarkdownBodyProps): React.JSX.Element {
  const [mode, setMode] = useState<BodyMode>('preview')
  const heading = `${label} (${lineCount(content)} lines)`

  if (layout === 'inline') {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <Heading text={heading} />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
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
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 shrink-0">
        <Heading text={heading} />
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      <ScrollArea className="flex-1">
        {mode === 'preview' ? (
          <div className="max-w-3xl mx-auto px-6 py-6">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <pre className="max-w-3xl mx-auto px-6 py-6 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {content}
          </pre>
        )}
      </ScrollArea>
    </div>
  )
}

function Heading({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
      {text}
    </p>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: BodyMode
  onChange: (mode: BodyMode) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden">
      <ModeButton active={mode === 'preview'} onClick={() => onChange('preview')} icon={Eye}>
        Preview
      </ModeButton>
      <ModeButton
        active={mode === 'raw'}
        onClick={() => onChange('raw')}
        icon={Code}
        className="border-l border-border"
      >
        Raw
      </ModeButton>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  className,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Eye
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {children}
    </button>
  )
}
