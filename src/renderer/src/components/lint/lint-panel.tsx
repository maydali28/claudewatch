import React, { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Info,
  ShieldCheck,
  X,
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useLintStore } from '@renderer/store/lint.store'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { useOpenSessionHealth } from '@renderer/hooks/use-session-health'
import {
  InsightSection,
  StatTiles,
  TH,
} from '@renderer/components/sessions/insights/insight-section'
import { LINT_RULE_MAP } from '@shared/constants/lint-rules'
import type { LintResult, LintSeverity } from '@shared/types'
import { areaOf, countBySeverity, groupByArea, scoreLabel } from './health-view'

const SEVERITY: Record<
  LintSeverity,
  { Icon: typeof Info; text: string; box: string; badge: string }
> = {
  error: {
    Icon: AlertCircle,
    text: 'text-red-500',
    box: 'bg-red-500/10',
    badge: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
  warning: {
    Icon: AlertTriangle,
    text: 'text-amber-500',
    box: 'bg-amber-500/10',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  info: {
    Icon: Info,
    text: 'text-blue-500',
    box: 'bg-blue-500/10',
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
}

const TONE_TEXT: Record<LintSeverity, string> = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-emerald-500',
}

function CopyButton({ value }: { value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
      className="ml-auto shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function DetailRow({
  label,
  children,
  copyValue,
}: {
  label: string
  children: React.ReactNode
  copyValue?: string
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 items-start px-4 py-3 border-b border-border/30 last:border-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold pt-0.5">
        {label}
      </span>
      <div className="flex items-start gap-1 min-w-0">
        <div className="flex-1 min-w-0 text-xs">{children}</div>
        {copyValue && <CopyButton value={copyValue} />}
      </div>
    </div>
  )
}

function useSessionTitle(sessionId: string | undefined): string | undefined {
  return useSessionsStore((s) => {
    if (!sessionId) return undefined
    for (const p of s.projects) {
      const found = p.sessions.find((x) => x.id === sessionId)
      if (found) return found.title || sessionId.slice(0, 8)
    }
    return sessionId.slice(0, 8)
  })
}

// ─── One result ───────────────────────────────────────────────────────────────

function ResultDetail({
  result,
  onClose,
}: {
  result: LintResult
  onClose: () => void
}): React.JSX.Element {
  const rule = LINT_RULE_MAP.get(result.checkId)
  const sev = SEVERITY[result.severity]
  const openSessionHealth = useOpenSessionHealth()
  const sessionTitle = useSessionTitle(result.session?.sessionId)
  const where = result.displayPath
    ? `${result.displayPath}${result.line !== undefined ? `:${result.line}` : ''}`
    : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div
          className={cn('flex items-center justify-center h-8 w-8 rounded-lg shrink-0', sev.box)}
        >
          <sev.Icon className={cn('h-4 w-4', sev.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{rule?.description ?? result.message}</h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <code className="text-[10px] font-mono text-muted-foreground">{result.checkId}</code>
            <span
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide',
                sev.badge
              )}
            >
              {result.severity}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {areaOf(result.checkId)}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Back to the overview"
          aria-label="Back to the overview"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
          <DetailRow label="Found">{result.message}</DetailRow>
          {where && (
            <DetailRow label="Where" copyValue={result.filePath || undefined}>
              <span className="font-mono break-all">{where}</span>
            </DetailRow>
          )}
          {result.session && (
            <DetailRow label="Session">
              <button
                onClick={() =>
                  openSessionHealth(result.session!.sessionId, result.session!.projectId)
                }
                className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
              >
                <span className="truncate">{sessionTitle}</span>
                <ArrowRight className="h-3 w-3 shrink-0" />
              </button>
            </DetailRow>
          )}
          {result.maskedSecret && (
            <DetailRow label="Value">
              <code className="font-mono rounded bg-muted px-1.5 py-0.5">
                {result.maskedSecret}
              </code>
              <span className="ml-2 text-muted-foreground">masked</span>
            </DetailRow>
          )}
          {result.contextLines && result.contextLines.length > 0 && (
            <DetailRow label="Context">
              <pre className="font-mono text-[11px] bg-muted/40 rounded p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {result.contextLines.join('\n')}
              </pre>
            </DetailRow>
          )}
          {result.fix && <DetailRow label="Fix">{result.fix}</DetailRow>}
        </div>
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview(): React.JSX.Element {
  const lintResults = useLintStore((s) => s.lintResults)
  const lintSummary = useLintStore((s) => s.lintSummary)
  const lastRunAt = useLintStore((s) => s.lastRunAt)
  const setSearch = useLintStore((s) => s.setSearch)
  const setSeverityFilter = useLintStore((s) => s.setSeverityFilter)

  const counts = countBySeverity(lintResults)
  const groups = groupByArea(lintResults)
  const score = lintSummary ? scoreLabel(lintSummary.healthScore) : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg shrink-0 bg-primary/10">
          <ShieldCheck className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Health</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {LINT_RULE_MAP.size} checks over your setup, sessions and transcripts
            {lastRunAt &&
              ` · last run ${lastRunAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <StatTiles
          tiles={[
            {
              label: 'Score',
              value: score ? <span className={TONE_TEXT[score.tone]}>{score.pct}%</span> : '—',
              hint: score?.label,
            },
            { label: 'Errors', value: counts.error, hint: 'fix these first' },
            { label: 'Warnings', value: counts.warning },
            { label: 'Info', value: counts.info },
          ]}
        />

        {lintResults.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Every check passes"
            description="Nothing to fix in your setup, sessions or transcripts"
          />
        ) : (
          <InsightSection
            title="By area"
            note="Pick an area to list its checks in the sidebar, or a check there to see what it means and how to fix it."
          >
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left">
                  <th className={TH}>Area</th>
                  <th className={`${TH} pl-3 text-right`}>Errors</th>
                  <th className={`${TH} pl-3 text-right`}>Warnings</th>
                  <th className={`${TH} pl-3 text-right`}>Info</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const c = countBySeverity(g.results)
                  return (
                    <tr key={g.area} className="border-t border-border/40">
                      <td className="py-1.5 pr-3">
                        <button
                          onClick={() => {
                            setSeverityFilter('all')
                            setSearch(g.area)
                          }}
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {g.area}
                        </button>
                      </td>
                      <td
                        className={cn(
                          'py-1.5 pl-3 text-right',
                          c.error > 0 ? 'text-red-500 font-medium' : 'text-muted-foreground'
                        )}
                      >
                        {c.error}
                      </td>
                      <td
                        className={cn(
                          'py-1.5 pl-3 text-right',
                          c.warning > 0 ? 'text-amber-600' : 'text-muted-foreground'
                        )}
                      >
                        {c.warning}
                      </td>
                      <td className="py-1.5 pl-3 text-right text-muted-foreground">{c.info}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </InsightSection>
        )}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function LintPanel(): React.JSX.Element {
  const lintResults = useLintStore((s) => s.lintResults)
  const isRunning = useLintStore((s) => s.isRunning)
  const lastRunAt = useLintStore((s) => s.lastRunAt)
  const error = useLintStore((s) => s.error)
  const selectedResultId = useLintStore((s) => s.selectedResultId)
  const setSelectedResult = useLintStore((s) => s.setSelectedResult)

  const selected = lintResults.find((r) => r.id === selectedResultId)
  if (selected) return <ResultDetail result={selected} onClose={() => setSelectedResult(null)} />

  if (!lastRunAt) {
    if (error) {
      return (
        <EmptyState
          icon={AlertCircle}
          title="The checks could not run"
          description={error}
          className="h-full"
        />
      )
    }
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">{isRunning ? 'Running the checks…' : ''}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  return <Overview />
}
