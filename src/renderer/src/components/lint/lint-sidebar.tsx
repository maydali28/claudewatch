import React, { useEffect } from 'react'
import { RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useLintStore } from '@renderer/store/lint.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { ScopeGroup } from '@renderer/components/config/scope-group'
import { SourceChips } from '@renderer/components/config/source-chips'
import type { LintResult, LintSeverity } from '@shared/types'
import {
  countBySeverity,
  filterHealthResults,
  groupByArea,
  type SeverityFilter,
} from './health-view'

const SEVERITY_DOT: Record<LintSeverity, string> = {
  error: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
}

function ResultItem({
  result,
  selected,
  onSelect,
}: {
  result: LintResult
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
      )}
    >
      <p className="flex items-start gap-1.5 min-w-0">
        <span
          className={cn(
            'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
            SEVERITY_DOT[result.severity]
          )}
          aria-hidden
        />
        <span
          className={cn(
            'text-xs font-medium line-clamp-2 leading-snug',
            selected ? 'text-primary' : 'text-foreground'
          )}
        >
          {result.message}
        </span>
      </p>
      <p className="text-[10px] text-muted-foreground/60 mt-0.5 pl-3 font-mono">
        {result.checkId} · {result.severity}
      </p>
    </button>
  )
}

export default function LintSidebar(): React.JSX.Element {
  const lintResults = useLintStore((s) => s.lintResults)
  const severityFilter = useLintStore((s) => s.severityFilter)
  const search = useLintStore((s) => s.search)
  const selectedResultId = useLintStore((s) => s.selectedResultId)
  const isRunning = useLintStore((s) => s.isRunning)
  const lastRunAt = useLintStore((s) => s.lastRunAt)
  const runLint = useLintStore((s) => s.runLint)
  const setSeverityFilter = useLintStore((s) => s.setSeverityFilter)
  const setSearch = useLintStore((s) => s.setSearch)
  const setSelectedResult = useLintStore((s) => s.setSelectedResult)

  // Fresh results each time the view opens, as before: findings arrive while
  // the app runs.
  useEffect(() => {
    void runLint()
  }, [runLint])

  const searched = filterHealthResults(lintResults, 'all', search)
  const counts = countBySeverity(searched)
  const groups = groupByArea(filterHealthResults(searched, severityFilter, ''))
  const total = lintResults.length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Health
          </span>
          {total > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {total}
            </span>
          )}
        </div>
        <button
          onClick={() => void runLint()}
          disabled={isRunning}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Run the checks again"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 text-muted-foreground', isRunning && 'animate-spin')}
          />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter checks…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {total > 0 && (
        <SourceChips<SeverityFilter>
          label="Filter checks by severity"
          value={severityFilter}
          onChange={setSeverityFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'error', label: 'Errors', count: counts.error },
            { value: 'warning', label: 'Warnings', count: counts.warning },
            { value: 'info', label: 'Info', count: counts.info },
          ]}
        />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isRunning && total === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isRunning && lastRunAt && total === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <ShieldCheck className="h-6 w-6 text-emerald-500/60 mb-2" />
            <p className="text-xs text-muted-foreground">Every check passes</p>
          </div>
        )}

        {total > 0 && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">
              {search ? <>No matches for &quot;{search}&quot;</> : 'Nothing at this severity'}
            </p>
          </div>
        )}

        {groups.map((g) => (
          <ScopeGroup key={g.area} label={g.area} count={g.results.length}>
            {g.results.map((r) => (
              <ResultItem
                key={r.id}
                result={r}
                selected={selectedResultId === r.id}
                onSelect={() => setSelectedResult(r.id)}
              />
            ))}
          </ScopeGroup>
        ))}
      </div>
    </div>
  )
}
