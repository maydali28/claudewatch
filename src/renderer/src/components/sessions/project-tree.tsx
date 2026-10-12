import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import type { Project, SessionSummary } from '@shared/types'
import {
  sessionHealth,
  useOpenSessionHealth,
  useSecretsBySession,
} from '@renderer/hooks/use-session-health'
import SessionListItem from './session-list-item'

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

  const secretsBySession = useSecretsBySession()
  const openSessionHealth = useOpenSessionHealth()

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
            const health = sessionHealth(session, secretsBySession.get(session.id))
            return (
              <SessionListItem
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                isLive={liveSessionIds.has(session.id)}
                searchQuery={searchQuery}
                health={health.count > 0 ? health : undefined}
                onOpenHealth={() => openSessionHealth(session.id, session.projectId)}
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
