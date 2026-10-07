import React, { useState, useEffect } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { AlertCircle, Bot, MessageSquare, ShieldAlert } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { getModelMeta } from '@renderer/lib/model-meta'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import type { SessionSummary } from '@shared/types'
import type { SessionHealth } from '@renderer/hooks/use-session-health'
import { isSessionLive, isSubagentRunning } from '@shared/utils/live-session'
import { ACTIVE_SESSION_MS, LIVE_REFRESH_INTERVAL_MS } from '@shared/constants/tuning'

function LintIndicator({
  health,
  onOpen,
}: {
  health: SessionHealth
  onOpen: () => void
}): React.JSX.Element {
  const colorClass =
    health.severity === 'error'
      ? 'text-destructive'
      : health.severity === 'warning'
        ? 'text-amber-500'
        : 'text-blue-500'
  const labels = [
    ...health.checks.map((c) => c.title),
    ...(health.secrets.length > 0
      ? [`${health.secrets.length} secret${health.secrets.length === 1 ? '' : 's'} found`]
      : []),
  ]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span, not a button: the whole row is already a button. */}
        <span
          className={`flex items-center rounded p-0.5 hover:bg-background ${colorClass}`}
          role="button"
          tabIndex={0}
          aria-label={`${health.count} health issues: open the session's Health tab`}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.stopPropagation()
            onOpen()
          }}
        >
          <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[10px]">
        <p className="font-semibold mb-0.5">
          {health.count} health issue{health.count > 1 ? 's' : ''}
        </p>
        {labels.map((l) => (
          <p key={l} className="text-muted-foreground">
            {l}
          </p>
        ))}
        <p className="mt-1 text-muted-foreground">Click for the session’s Health tab</p>
      </TooltipContent>
    </Tooltip>
  )
}

interface SessionListItemProps {
  session: SessionSummary
  isActive: boolean
  isLive: boolean
  /** Total tokens across all sessions in the same project, for the progress bar */
  projectTotalTokens: number
  searchQuery?: string
  /** Set when the session fails a check or holds a secret. */
  health?: SessionHealth
  onOpenHealth?: () => void
  onClick: () => void
}

function formatShortRelativeTime(timestamp: string): string {
  if (!timestamp) return '—'
  const diffMs = Date.now() - new Date(timestamp).getTime()
  if (diffMs < ACTIVE_SESSION_MS) return 'just now'

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
  health,
  onOpenHealth,
  onClick,
}: SessionListItemProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => setNow(Date.now()), LIVE_REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isLive])

  // `isLive` gates on "this window saw a push for it"; the shared rule then
  // ages it exactly as the tray does, so the two surfaces agree.
  // Background sub-agents keep working after the parent's turn has closed, so
  // a session with one still running counts as live too.
  const runningAgents = isLive
    ? (session.subagents ?? []).filter((s) => isSubagentRunning(s, now)).length
    : 0
  const live = (isLive && isSessionLive(session, now)) || runningAgents > 0
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
            {runningAgents > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 rounded-sm bg-green-500/10 px-1 text-green-600 cursor-default">
                    <Bot className="h-2.5 w-2.5" />
                    <span>{runningAgents}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-[10px]">
                  {runningAgents} sub-agent{runningAgents === 1 ? '' : 's'} running
                </TooltipContent>
              </Tooltip>
            )}
            {health && onOpenHealth && <LintIndicator health={health} onOpen={onOpenHealth} />}
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
          {/* Latest, not dominant: the badge answers "what is this session on
              now", which is not the same question as "what did it use most". */}
          {(session.latestModel ?? session.dominantModel) &&
            (() => {
              const meta = getModelMeta(session.latestModel ?? session.dominantModel)
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
