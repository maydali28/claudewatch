import React, { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { History, Loader2, ShieldAlert, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useSecretsStore } from '@renderer/store/secrets.store'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useUIStore } from '@renderer/store/ui.store'
import { cn } from '@renderer/lib/cn'
import type { SecretFindingRecord } from '@shared/types'

function when(f: SecretFindingRecord): string {
  const at = f.occurredAt ?? f.foundAt
  const date = new Date(at)
  return Number.isFinite(date.getTime()) ? `${formatDistanceToNowStrict(date)} ago` : ''
}

/**
 * Secrets found in transcripts, live or by a history scan, with a way to open
 * the session and to dismiss each. Only masked values are ever shown or kept.
 */
export function SecretFindingsList(): React.JSX.Element {
  const { findings, isLoaded, isScanning, lastScan, load, dismiss, scanHistory } = useSecretsStore()
  const projects = useSessionsStore((s) => s.projects)
  const loadParsedSession = useSessionsStore((s) => s.loadParsedSession)
  const setView = useUIStore((s) => s.setView)
  const [showDismissed, setShowDismissed] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const titles = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) for (const s of p.sessions) map.set(s.id, s.title || s.id.slice(0, 8))
    return map
  }, [projects])

  const active = findings.filter((f) => !f.dismissed)
  const dismissedCount = findings.length - active.length
  const shown = [...(showDismissed ? findings : active)].sort((a, b) =>
    (b.occurredAt ?? b.foundAt).localeCompare(a.occurredAt ?? a.foundAt)
  )

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Secrets found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {active.length === 0
              ? 'Nothing to look at.'
              : `${active.length} to look at. Rotate a real key, then dismiss it here.`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void scanHistory()}
          disabled={isScanning}
          className="shrink-0 gap-1.5"
        >
          {isScanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <History className="h-3.5 w-3.5" />
          )}
          {isScanning ? 'Scanning…' : 'Scan older sessions'}
        </Button>
      </div>

      {lastScan && !isScanning && (
        <p className="text-xs text-muted-foreground">
          Checked {lastScan.filesScanned.toLocaleString()} transcript
          {lastScan.filesScanned === 1 ? '' : 's'} in {(lastScan.durationMs / 1000).toFixed(1)}s:{' '}
          {lastScan.newFindings === 0 ? 'nothing new.' : `${lastScan.newFindings} new.`}
        </p>
      )}

      {isLoaded && shown.length > 0 && (
        <ul className="divide-y divide-border/50 rounded-lg border">
          {shown.map((f) => (
            <li
              key={f.id}
              className={cn('flex items-start gap-3 px-3 py-2.5', f.dismissed && 'opacity-50')}
            >
              <ShieldAlert
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  f.severity === 'error' ? 'text-destructive' : 'text-amber-500'
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {f.patternName}{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    {f.maskedValue}
                  </code>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  <button
                    type="button"
                    className="text-foreground underline-offset-2 hover:underline"
                    onClick={() => {
                      setView('sessions')
                      loadParsedSession(f.sessionId, f.projectId)
                    }}
                  >
                    {titles.get(f.sessionId) ?? f.sessionId.slice(0, 8)}
                  </button>
                  {f.agentId && ' · in a sub-agent'}
                  {f.lineNumber !== undefined && ` · line ${f.lineNumber}`}
                  {when(f) && ` · ${when(f)}`}
                  {f.source === 'history' && ' · found by history scan'}
                </p>
              </div>
              {!f.dismissed && (
                <button
                  type="button"
                  onClick={() => void dismiss([f.id])}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Dismiss"
                  title="Dismiss: it is rotated, or not a real secret"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {dismissedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowDismissed((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}
        </button>
      )}
    </div>
  )
}
