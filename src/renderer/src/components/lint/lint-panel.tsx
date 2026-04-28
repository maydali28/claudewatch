import React, { useEffect } from 'react'
import { Play, ShieldCheck, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useLintStore } from '@renderer/store/lint.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { HealthScoreGauge } from './health-score-gauge'
import { LintResultRow } from './lint-result-row'
import { SecretFindings } from './secret-findings'

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({
  icon: Icon,
  count,
  label,
  color,
}: {
  icon: React.ElementType
  count: number
  label: string
  color: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-lg border border-border bg-card">
      <Icon className={cn('h-5 w-5', color)} />
      <span className={cn('text-2xl font-bold tabular-nums', color)}>{count}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  )
}

// ─── Category group ───────────────────────────────────────────────────────────

function CategoryGroup({
  category,
  results,
}: {
  category: string
  results: ReturnType<ReturnType<typeof useLintStore.getState>['filteredResults']>
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {category}
        </h3>
        <span className="text-[10px] text-muted-foreground">({results.length})</span>
      </div>
      <div className="space-y-2">
        {results.map((r) => (
          <LintResultRow key={r.id} result={r} />
        ))}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function LintPanel(): React.JSX.Element {
  const { lintSummary, isRunning, lastRunAt, runLint, filteredResults, secrets } = useLintStore()

  useEffect(() => {
    runLint()
  }, [runLint])

  const filtered = filteredResults()
  const secretResults = secrets()

  // Group by category
  const grouped = React.useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const r of filtered) {
      const cat = r.checkId.startsWith('SEC')
        ? 'Secrets'
        : r.checkId.startsWith('SES')
          ? 'Sessions'
          : r.checkId.startsWith('CFG')
            ? 'Config'
            : r.checkId.startsWith('CMD')
              ? 'CLAUDE.md'
              : r.checkId.startsWith('RUL')
                ? 'Rules'
                : r.checkId.startsWith('SKL')
                  ? 'Skills'
                  : r.checkId.startsWith('XCT')
                    ? 'Cross-cutting'
                    : 'Other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(r)
    }
    return map
  }, [filtered])

  if (isRunning && !lintSummary) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Play className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Running lint checks…</span>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    )
  }

  if (!lintSummary) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3">
        <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No results yet</p>
        <button
          onClick={() => runLint()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Play className="h-3.5 w-3.5" />
          Run Lint
        </button>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">Config Health</h2>
          {lastRunAt && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Last run {lastRunAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <button
          onClick={() => runLint()}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Play className={cn('h-3.5 w-3.5', isRunning && 'animate-pulse')} />
          {isRunning ? 'Running…' : 'Re-run'}
        </button>
      </div>

      {/* Health gauge + stat chips */}
      <div className="flex items-center gap-6">
        <HealthScoreGauge score={lintSummary.healthScore} size={120} />
        <div className="grid grid-cols-3 gap-2 flex-1">
          <StatChip
            icon={AlertCircle}
            count={lintSummary.errorCount}
            label="Errors"
            color="text-red-500"
          />
          <StatChip
            icon={AlertTriangle}
            count={lintSummary.warningCount}
            label="Warnings"
            color="text-amber-500"
          />
          <StatChip icon={Info} count={lintSummary.infoCount} label="Info" color="text-blue-500" />
        </div>
      </div>

      {/* Secret findings (prioritized at top) */}
      {secretResults.length > 0 && <SecretFindings findings={secretResults} />}

      {/* Result groups */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <ShieldCheck className="h-8 w-8 text-green-500" />
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            All checks passed
          </p>
          <p className="text-xs text-muted-foreground">No issues found with current filters</p>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([cat, results]) => (
          <CategoryGroup key={cat} category={cat} results={results} />
        ))
      )}
    </div>
  )
}
