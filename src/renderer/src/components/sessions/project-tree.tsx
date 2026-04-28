import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import type { Project, SessionSummary, LintCheckId, LintSeverity } from '@shared/types'
import SessionListItem from './session-list-item'

// Mirrors SES001–SES006 thresholds from lint-rules/ses.rules.ts
const SES_COST = 25.0
const SES_COMPACTIONS = 5
const SES_TOKENS = 2_000_000
const SES_STALE_MS = 14 * 24 * 60 * 60 * 1000
const SES_STALE_MIN_MSGS = 10

function deriveSessionLintFlags(session: SessionSummary): {
  flags: LintCheckId[]
  severity: LintSeverity | null
} {
  const flags: LintCheckId[] = []
  const totalTokens = session.totalInputTokens + session.totalOutputTokens

  if (session.estimatedCost > SES_COST) flags.push('SES001')
  if (session.compactionCount >= SES_COMPACTIONS) flags.push('SES002')
  if (totalTokens > SES_TOKENS) flags.push('SES003')
  if (
    Date.now() - new Date(session.lastTimestamp).getTime() > SES_STALE_MS &&
    session.messageCount >= SES_STALE_MIN_MSGS
  ) {
    flags.push('SES004')
  }
  if (session.hasError) flags.push('SES005')
  if (session.observability.hasIdleZombieGap) flags.push('SES006')

  if (flags.length === 0) return { flags, severity: null }
  const warningSet = new Set<LintCheckId>(['SES001', 'SES002', 'SES003', 'SES005', 'SES006'])
  const severity: LintSeverity = flags.some((f) => warningSet.has(f)) ? 'warning' : 'info'
  return { flags, severity }
}

interface ProjectTreeProps {
  project: Project
  sessions: SessionSummary[]
  activeSessionId: string | null
  liveSessionIds: Set<string>
  onSelectSession: (sessionId: string, projectId: string) => void
  searchQuery?: string
}

export default function ProjectTree({
  project,
  sessions,
  activeSessionId,
  liveSessionIds,
  onSelectSession,
  searchQuery = '',
}: ProjectTreeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)

  const projectTotalTokens = sessions.reduce(
    (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens,
    0
  )

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md',
          'hover:bg-accent/40 transition-colors text-left'
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="truncate flex-1 text-foreground">{project.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
          {sessions.length}
        </span>
      </button>

      {expanded && sessions.length > 0 && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-border/40 pl-2">
          {sessions.map((session) => {
            const { flags, severity } = deriveSessionLintFlags(session)
            return (
              <SessionListItem
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                isLive={liveSessionIds.has(session.id)}
                projectTotalTokens={projectTotalTokens}
                searchQuery={searchQuery}
                lintFlags={flags.length > 0 ? flags : undefined}
                lintSeverity={severity ?? undefined}
                onClick={() => onSelectSession(session.id, session.projectId)}
              />
            )
          })}
        </div>
      )}

      {expanded && sessions.length === 0 && (
        <p className="ml-6 py-1 text-[10px] text-muted-foreground">No sessions</p>
      )}
    </div>
  )
}
