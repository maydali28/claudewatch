import React, { useState } from 'react'
import { ChevronDown, ChevronRight, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { LINT_RULE_MAP } from '@shared/constants/lint-rules'
import type { LintResult } from '@shared/types'

const SEVERITY_ICON = {
  error: { Icon: AlertCircle, cls: 'text-red-500' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-500' },
  info: { Icon: Info, cls: 'text-blue-500' },
}

const SEVERITY_BADGE = {
  error: 'bg-red-500/10 text-red-600 dark:text-red-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'bg-blue-500/10 text-blue-500',
}

interface LintResultRowProps {
  result: LintResult
}

export function LintResultRow({ result }: LintResultRowProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = LINT_RULE_MAP.get(result.checkId)
  const { Icon, cls } = SEVERITY_ICON[result.severity]
  const hasExtra = !!(result.fix || result.contextLines?.length || result.maskedSecret)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => hasExtra && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
          hasExtra ? 'hover:bg-accent/50' : 'cursor-default'
        )}
      >
        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', cls)} />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase',
                SEVERITY_BADGE[result.severity]
              )}
            >
              {result.severity}
            </span>
            <code className="text-[10px] font-mono text-muted-foreground">{result.checkId}</code>
            {meta?.category && (
              <span className="text-[10px] text-muted-foreground/60">{meta.category}</span>
            )}
          </div>

          <p className="text-xs text-foreground leading-snug">{result.message}</p>

          {result.displayPath && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
              {result.displayPath}
              {result.line !== undefined && `:${result.line}`}
            </p>
          )}
        </div>

        {hasExtra && (
          <span className="shrink-0 mt-0.5">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
        )}
      </button>

      {open && hasExtra && (
        <div className="border-t border-border/50 px-4 pb-3 space-y-2 pt-2">
          {result.maskedSecret && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
                Masked value
              </p>
              <code className="text-xs font-mono bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-1 rounded">
                {result.maskedSecret}
              </code>
            </div>
          )}

          {result.contextLines && result.contextLines.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
                Context
              </p>
              <pre className="text-xs font-mono bg-muted/40 rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {result.contextLines.join('\n')}
              </pre>
            </div>
          )}

          {result.fix && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
                Fix
              </p>
              <p className="text-xs text-foreground leading-relaxed">{result.fix}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
