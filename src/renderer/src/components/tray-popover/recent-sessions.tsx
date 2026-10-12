import React from 'react'
import { MessageSquare, AlertCircle, Folder } from 'lucide-react'
import type { TraySnapshotSession } from '@shared/types/analytics'
import { formatTokens } from '@shared/utils/format-tokens'
import { projectDisplayName } from '@shared/utils/decode-project-id'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc-client'
import { getModelMeta } from '@renderer/lib/model-meta'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ContextFillBar } from '@renderer/components/shared/context-fill-bar'
import { contextFillView } from '@renderer/components/shared/context-fill-rules'
import type { CostAlertThresholds } from '@shared/types/cost-alerts'
import { formatCost } from '@shared/utils/format-cost'
import { sessionLimitNotice } from './cost-limits'

interface RecentSessionsProps {
  sessions: TraySnapshotSession[]
  /** Cost alerts in force (0 = off); a row over the session limit shows its cost. */
  costLimits: CostAlertThresholds
}

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function RecentSessionRow({
  session,
  costLimits,
}: {
  session: TraySnapshotSession
  costLimits: CostAlertThresholds
}): React.JSX.Element {
  const overLimit = sessionLimitNotice(session.estimatedCost, costLimits)
  const handleClick = (): void => {
    ipc.tray.openDashboard(session.id, session.projectId)
  }
  const meta = getModelMeta(session.latestModel ?? session.primaryModel)
  const projectName = projectDisplayName(session.projectPath)
  const sessionTokens = session.totalInputTokens + session.totalOutputTokens
  const fill = contextFillView(session.contextFill)

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            'w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent'
          )}
        >
          {/* Title row — status dot + title + model name */}
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {session.hasError ? (
                <AlertCircle className="h-2.5 w-2.5 shrink-0 text-destructive" />
              ) : (
                <span className="block h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
              )}
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

          {/* Detail row — tokens · messages · time (left) | project (right) */}
          <div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5 min-w-0 shrink">
              <span className="tabular-nums whitespace-nowrap">{formatTokens(sessionTokens)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 whitespace-nowrap">
                <MessageSquare className="h-2.5 w-2.5" />
                <span className="tabular-nums">{session.messageCount}</span>
              </span>
              {overLimit && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span
                    className="tabular-nums whitespace-nowrap font-semibold text-red-600 dark:text-red-400"
                    title={overLimit}
                  >
                    {formatCost(session.estimatedCost)}
                  </span>
                </>
              )}
              <span className="text-muted-foreground/40">·</span>
              <span className="tabular-nums whitespace-nowrap">
                {relativeTime(session.lastTimestamp)}
              </span>
            </div>
            <div className="flex items-center gap-1 min-w-0 shrink">
              <Folder className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate" title={projectName}>
                {projectName}
              </span>
            </div>
          </div>

          {/* Context window used */}
          <ContextFillBar view={fill} normalClass="bg-primary/40" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8}>
        <div className="flex flex-col gap-0.5">
          <span>{meta.label}</span>
          <span className="text-[10px] opacity-70">{projectName}</span>
          <span className="text-[10px] opacity-70">{fill.description}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function RecentSessions({
  sessions,
  costLimits,
}: RecentSessionsProps): React.JSX.Element | null {
  if (sessions.length === 0) return null

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-1 mb-0.5">
        <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
          Recent
        </span>
      </div>
      {sessions.map((s) => (
        <RecentSessionRow key={s.id} session={s} costLimits={costLimits} />
      ))}
    </div>
  )
}
