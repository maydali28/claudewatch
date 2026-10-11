import React from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Info,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { useLintStore } from '@renderer/store/lint.store'
import { useSecretsStore } from '@renderer/store/secrets.store'
import { useUIStore } from '@renderer/store/ui.store'
import { cn } from '@renderer/lib/cn'
import type { SessionHealth } from '@renderer/hooks/use-session-health'
import type { LintSeverity, SecretFindingRecord, SessionMetadata } from '@shared/types'
import { InsightSection } from './insight-section'

const SEVERITY: Record<LintSeverity, { Icon: typeof Info; cls: string }> = {
  error: { Icon: AlertCircle, cls: 'text-destructive' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-500' },
  info: { Icon: Info, cls: 'text-blue-500' },
}

function formatGap(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** What the transcript adds to a check's one-line message. */
function checkDetail(checkId: string, metadata: SessionMetadata | undefined): string | null {
  if (checkId === 'SES006' && metadata && metadata.maxIdleGapSeconds > 0) {
    const after = metadata.idleGapAfterTimestamp ? new Date(metadata.idleGapAfterTimestamp) : null
    const when =
      after && Number.isFinite(after.getTime()) ? `, after ${format(after, 'HH:mm, d MMM')}` : ''
    return `Longest pause: ${formatGap(metadata.maxIdleGapSeconds)}${when}.`
  }
  return null
}

function secretWhere(f: SecretFindingRecord): string {
  const at = new Date(f.occurredAt ?? f.foundAt)
  return [
    f.agentId ? 'in a sub-agent' : 'in the conversation',
    f.lineNumber !== undefined ? `line ${f.lineNumber}` : null,
    Number.isFinite(at.getTime()) ? `${formatDistanceToNowStrict(at)} ago` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The session's Health tab: the session checks it fails and the secrets found
 * in it. Setup checks are about the whole configuration, not this session, so
 * they are only summed up here, with a way to the Health view.
 */
export function SessionHealthTab({
  health,
  metadata,
  onOpenSubagent,
}: {
  health: SessionHealth
  metadata?: SessionMetadata
  onOpenSubagent: (agentId: string) => void
}): React.JSX.Element {
  const dismiss = useSecretsStore((s) => s.dismiss)
  const setView = useUIStore((s) => s.setView)
  const lintResults = useLintStore((s) => s.lintResults)
  const lastRunAt = useLintStore((s) => s.lastRunAt)

  const setup = lintResults.filter((r) => !r.session)
  const setupErrors = setup.filter((r) => r.severity === 'error').length
  const setupWarnings = setup.filter((r) => r.severity === 'warning').length

  const setupLine = !lastRunAt
    ? 'Setup checks have not run yet in this window.'
    : setup.length === 0
      ? 'Your setup passes every check.'
      : `Your setup has ${setupErrors} error${setupErrors === 1 ? '' : 's'} and ${setupWarnings} warning${setupWarnings === 1 ? '' : 's'}.`

  return (
    <div className="space-y-4">
      {health.count === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing wrong in this session"
          description="It passes every session check, and no secret was found in it"
        />
      ) : (
        <>
          {health.checks.length > 0 && (
            <InsightSection
              title={`Session checks (${health.checks.length})`}
              note="Thresholds the session went past. They describe this session only."
            >
              <ul className="space-y-2">
                {health.checks.map((c) => {
                  const { Icon, cls } = SEVERITY[c.severity]
                  const detail = checkDetail(c.checkId, metadata)
                  return (
                    <li
                      key={c.checkId}
                      className="flex items-start gap-3 rounded-md border border-border/40 px-3 py-2.5"
                    >
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', cls)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <code className="mr-2 font-mono text-[10px] text-muted-foreground">
                            {c.checkId}
                          </code>
                          {c.message}
                        </p>
                        {detail && <p className="mt-0.5 text-xs text-foreground/80">{detail}</p>}
                        <p className="mt-1 text-xs text-muted-foreground">{c.fix}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </InsightSection>
          )}

          {health.secrets.length > 0 && (
            <InsightSection
              title={`Secrets found (${health.secrets.length})`}
              note="Rotate a real key, then dismiss it. Only masked values are kept."
            >
              <ul className="space-y-2">
                {health.secrets.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/[0.03] px-3 py-2.5"
                  >
                    <ShieldAlert
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        f.severity === 'error' ? 'text-destructive' : 'text-amber-500'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        {f.patternName}{' '}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                          {f.maskedValue}
                        </code>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {secretWhere(f)}
                        {f.agentId && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              onClick={() => onOpenSubagent(f.agentId!)}
                              className="text-foreground underline-offset-2 hover:underline"
                            >
                              Open the sub-agent
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void dismiss([f.id])}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Dismiss"
                      title="Dismiss: it is rotated, or not a real secret"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </InsightSection>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {setupLine} Setup checks cover settings, CLAUDE.md, skills and commands, the same for
          every session.
        </p>
        <button
          type="button"
          onClick={() => setView('lint')}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open Health
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
