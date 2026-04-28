import React, { useState } from 'react'
import { ShieldAlert, Eye, EyeOff } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { LINT_RULE_MAP } from '@shared/constants/lint-rules'
import type { LintResult } from '@shared/types'

interface SecretFindingsProps {
  findings: LintResult[]
}

function SecretRow({ finding }: { finding: LintResult }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false)
  const meta = LINT_RULE_MAP.get(finding.checkId)

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <ShieldAlert className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-[10px] font-mono text-red-600 dark:text-red-400 font-semibold">
              {finding.checkId}
            </code>
            {meta && <span className="text-[10px] text-muted-foreground">{meta.description}</span>}
          </div>

          <p className="text-xs text-foreground leading-snug">{finding.message}</p>

          {finding.displayPath && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
              {finding.displayPath}
              {finding.line !== undefined && `:${finding.line}`}
            </p>
          )}

          {finding.maskedSecret && (
            <div className="flex items-center gap-2 mt-2">
              <code
                className={cn(
                  'text-xs font-mono px-2 py-0.5 rounded',
                  revealed
                    ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                    : 'bg-muted text-muted-foreground tracking-widest'
                )}
              >
                {revealed ? finding.maskedSecret : '••••••••••••'}
              </code>
              <button
                onClick={() => setRevealed((v) => !v)}
                className="p-1 rounded hover:bg-accent transition-colors"
                title={revealed ? 'Hide' : 'Reveal masked value'}
              >
                {revealed ? (
                  <EyeOff className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <Eye className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SecretFindings({ findings }: SecretFindingsProps): React.JSX.Element {
  if (findings.length === 0) return <></>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-red-500" />
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Secret Findings ({findings.length})
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Potential secrets detected in session history. Review and rotate any exposed credentials.
      </p>
      <div className="space-y-2">
        {findings.map((f) => (
          <SecretRow key={f.id} finding={f} />
        ))}
      </div>
    </div>
  )
}
