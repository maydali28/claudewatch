import React, { useEffect } from 'react'
import { Play, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useLintStore } from '@renderer/store/lint.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { LintSeverity } from '@shared/types'

const SEVERITY_OPTIONS: { value: LintSeverity | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Warnings' },
  { value: 'info', label: 'Info' },
]

const SEVERITY_COLORS: Record<LintSeverity, string> = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
}

export default function LintSidebar(): React.JSX.Element {
  const {
    lintSummary,
    lintResults,
    severityFilter,
    ruleFilter,
    isRunning,
    lastRunAt,
    runLint,
    setSeverityFilter,
    setRuleFilter,
    filteredResults,
    secrets,
  } = useLintStore()

  useEffect(() => {
    if (lintResults.length === 0 && !isRunning) runLint()
  }, [lintResults.length, isRunning, runLint])

  const filtered = filteredResults()
  const secretCount = secrets().length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Config Health
        </span>
        <button
          onClick={() => runLint()}
          disabled={isRunning}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          title="Run lint"
        >
          <Play className={cn('h-3 w-3', isRunning && 'animate-pulse')} />
          {isRunning ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Summary row */}
      {lintSummary && (
        <div className="px-3 py-2 border-b border-border/30 flex items-center gap-3">
          <span className="text-[10px] text-red-500 font-semibold">{lintSummary.errorCount}E</span>
          <span className="text-[10px] text-amber-500 font-semibold">
            {lintSummary.warningCount}W
          </span>
          <span className="text-[10px] text-blue-500 font-semibold">{lintSummary.infoCount}I</span>
          {secretCount > 0 && (
            <span className="text-[10px] text-red-600 font-semibold ml-auto">
              {secretCount} secret{secretCount !== 1 ? 's' : ''}
            </span>
          )}
          {lastRunAt && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {lastRunAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* Severity filter */}
      <div className="px-2 py-1.5 border-b border-border/30 flex gap-1">
        {SEVERITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSeverityFilter(opt.value)}
            className={cn(
              'flex-1 py-1 rounded text-[10px] font-medium transition-colors',
              severityFilter === opt.value
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Rule ID filter */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            placeholder="Filter by rule ID…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {ruleFilter && (
            <button
              onClick={() => setRuleFilter('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Result list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isRunning && lintResults.length === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isRunning && filtered.length === 0 && lintResults.length > 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-muted-foreground">No results match filters</p>
          </div>
        )}

        {!isRunning && lintResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">Click Run to scan config health</p>
          </div>
        )}

        {filtered.map((result) => (
          <div
            key={result.id}
            className="rounded-md px-2.5 py-2 hover:bg-accent/50 transition-colors cursor-default"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className={cn(
                  'text-[9px] font-bold uppercase tracking-wider',
                  SEVERITY_COLORS[result.severity]
                )}
              >
                {result.severity[0].toUpperCase()}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">{result.checkId}</span>
            </div>
            <p className="text-xs text-foreground leading-snug line-clamp-2">{result.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
