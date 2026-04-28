import React, { useState, useEffect } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { AlertCircle, MessageSquare, ShieldAlert } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { getModelMeta } from '@renderer/lib/model-meta'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import type { SessionSummary, LintCheckId, LintSeverity } from '@shared/types'
import { useFeatureFlags } from '@renderer/store/feature-flags.store'

interface LintIndicatorProps {
  flags: LintCheckId[]
  severity: LintSeverity
}

function LintIndicator({ flags, severity }: LintIndicatorProps): React.JSX.Element {
  const colorClass =
    severity === 'error'
      ? 'text-destructive'
      : severity === 'warning'
        ? 'text-amber-500'
        : 'text-blue-500'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`flex items-center ${colorClass}`}>
            <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-[10px]">
          <p className="font-semibold mb-0.5">
            {flags.length} lint issue{flags.length > 1 ? 's' : ''}
          </p>
          <p className="text-muted-foreground">{flags.join(', ')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface SessionListItemProps {
  session: SessionSummary
  isActive: boolean
  isLive: boolean
  /** Total tokens across all sessions in the same project, for the progress bar */
  projectTotalTokens: number
  searchQuery?: string
  lintFlags?: LintCheckId[]
  lintSeverity?: LintSeverity
  onClick: () => void
}

const LIVE_REFRESH_INTERVAL_MS = 15_000
const JUST_NOW_THRESHOLD_MS = 60_000

function formatShortRelativeTime(timestamp: string): string {
  if (!timestamp) return '—'
  const diffMs = Date.now() - new Date(timestamp).getTime()
  if (diffMs < JUST_NOW_THRESHOLD_MS) return 'just now'

  const distance = formatDistanceToNowStrict(new Date(timestamp), {
    roundingMethod: 'floor',
  })
  // date-fns strict gives e.g. "4 hours", "2 days", "1 minute" — shorten units
  return (
    distance
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' months', 'mo')
      .replace(' month', 'mo')
      .replace(' years', 'y')
      .replace(' year', 'y') + ' ago'
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-300/60 text-foreground rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function SessionListItem({
  session,
  isActive,
  isLive,
  projectTotalTokens,
  searchQuery = '',
  lintFlags,
  lintSeverity,
  onClick,
}: SessionListItemProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const lintEnabled = useFeatureFlags((s) => s.lint)

  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => setNow(Date.now()), LIVE_REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isLive])

  const live = isLive && now - new Date(session.lastTimestamp).getTime() < JUST_NOW_THRESHOLD_MS
  const sessionTokens = session.totalInputTokens + session.totalOutputTokens
  const pct = projectTotalTokens > 0 ? Math.min(100, (sessionTokens / projectTotalTokens) * 100) : 0

  return (
    <TooltipProvider>
      <button
        onClick={onClick}
        className={cn(
          'w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent',
          isActive ? 'bg-primary/10 ring-1 ring-primary/30' : ''
        )}
      >
        {/* Title row */}
        <div className="flex items-center justify-between mb-1 gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {live ? (
              <span className="block h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" />
            ) : session.hasError ? (
              <AlertCircle className="h-2.5 w-2.5 shrink-0 text-destructive" />
            ) : (
              <span className="block h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
            )}
            <span
              className={cn(
                'truncate text-xs font-medium',
                isActive ? 'text-primary' : 'text-foreground'
              )}
              title={session.title || session.id}
            >
              {highlightMatch(session.title || session.id.slice(0, 8), searchQuery)}
            </span>
          </div>
          <div className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
            {lintEnabled && lintFlags && lintFlags.length > 0 && lintSeverity && (
              <LintIndicator flags={lintFlags} severity={lintSeverity} />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 cursor-default">
                  <MessageSquare className="h-2.5 w-2.5" />
                  <span>{session.messageCount}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-[10px]">
                {session.messageCount} messages
                {session.parentMessageCount !== undefined &&
                  session.messageCount > session.parentMessageCount && (
                    <span className="text-muted-foreground ml-1">
                      ({session.parentMessageCount} parent +{' '}
                      {session.messageCount - session.parentMessageCount} subagent)
                    </span>
                  )}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isActive ? 'bg-primary' : 'bg-primary/40'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Meta row */}
        <div className="mt-0.5 flex items-center justify-between gap-1">
          <span className="text-[10px] text-muted-foreground">
            {formatShortRelativeTime(session.lastTimestamp)} · {pct.toFixed(0)}%
          </span>
          {session.primaryModel &&
            (() => {
              const meta = getModelMeta(session.primaryModel)
              return (
                <span
                  className={`rounded-sm px-1 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                >
                  {meta.label}
                </span>
              )
            })()}
        </div>
      </button>
    </TooltipProvider>
  )
}
