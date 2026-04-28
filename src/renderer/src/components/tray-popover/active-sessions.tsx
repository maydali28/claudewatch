import React from 'react'
import { MessageSquare, Folder } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { formatTokens } from '@shared/utils/format-tokens'
import { projectDisplayName } from '@shared/utils/decode-project-id'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc-client'
import { getModelMeta } from '@renderer/lib/model-meta'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'

const MAX_VISIBLE = 4

interface ActiveSessionsProps {
  sessions: SessionSummary[]
  /** Sum of all tokens across visible sessions, used for relative progress bars */
  totalTokens: number
}

function ActiveSessionRow({
  session,
  totalTokens,
}: {
  session: SessionSummary
  totalTokens: number
}): React.JSX.Element {
  const handleClick = (): void => {
    ipc.tray.openDashboard(session.id, session.projectId)
  }

  const meta = getModelMeta(session.primaryModel)
  const projectName = projectDisplayName(session.projectPath)
  const sessionTokens = session.totalInputTokens + session.totalOutputTokens
  const pct = totalTokens > 0 ? Math.min(100, (sessionTokens / totalTokens) * 100) : 0

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            'w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent',
            'bg-emerald-500/5 ring-1 ring-emerald-500/30'
          )}
        >
          {/* Title row — status dot + title + model name */}
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="relative flex items-center justify-center w-2 h-2 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span
                className="truncate text-xs font-medium text-foreground"
                title={session.title || session.id}
              >
                {session.title || session.slug || session.id.slice(0, 8)}
              </span>
            </div>
            <span
              className="shrink-0 text-[10px] font-semibold tracking-tight whitespace-nowrap"
              style={{ color: meta.color }}
            >
              {meta.label}
            </span>
          </div>

          {/* Detail row — tokens · messages (left) | project (right) */}
          <div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5 min-w-0 shrink">
              <span className="tabular-nums whitespace-nowrap">{formatTokens(sessionTokens)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 whitespace-nowrap">
                <MessageSquare className="h-2.5 w-2.5" />
                <span className="tabular-nums">{session.messageCount}</span>
              </span>
            </div>
            <div className="flex items-center gap-1 min-w-0 shrink">
              <Folder className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate" title={projectName}>
                {projectName}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8}>
        <div className="flex flex-col gap-0.5">
          <span>{meta.label}</span>
          <span className="text-[10px] opacity-70">{projectName}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function ActiveSessions({
  sessions,
  totalTokens,
}: ActiveSessionsProps): React.JSX.Element | null {
  if (sessions.length === 0) return null

  const visible = sessions.slice(0, MAX_VISIBLE)
  const overflow = sessions.length - MAX_VISIBLE

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 mb-0.5">
        <span className="relative flex items-center justify-center w-1.5 h-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
          Live
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {sessions.length}
        </span>
      </div>

      {visible.map((s) => (
        <ActiveSessionRow key={s.id} session={s} totalTokens={totalTokens} />
      ))}

      {overflow > 0 && (
        <p className="text-center text-[10px] text-muted-foreground py-0.5">+{overflow} more</p>
      )}
    </div>
  )
}
