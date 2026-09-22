import React, { useState } from 'react'
import { Code, Eye } from 'lucide-react'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { cn } from '@renderer/lib/cn'
import { lineCount } from './markdown-body-rules'

type BodyMode = 'preview' | 'raw'

interface MarkdownBodyProps {
  content: string
  /** Heading word: "Body" for a skill or command, "Content" for a plan. */
  label: string
}

/**
 * A markdown body with a "{label} (N lines)" heading and a Preview / Raw
 * toggle: the heading row, then the rendered markdown in a card or the
 * source in a monospace block. One component and one look for skills,
 * plans and commands; the caller provides the scrolling, padded page it
 * sits in.
 */
export default function MarkdownBody({ content, label }: MarkdownBodyProps): React.JSX.Element {
  const [mode, setMode] = useState<BodyMode>('preview')
  const heading = `${label} (${lineCount(content)} lines)`

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
