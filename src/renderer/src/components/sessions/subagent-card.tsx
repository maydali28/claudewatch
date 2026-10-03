import React from 'react'
import { Clock, CornerDownRight } from 'lucide-react'
import { formatTokens, formatCost } from '@shared/utils'
import { getModelMeta } from '@renderer/lib/model-meta'
import { cn } from '@renderer/lib/cn'
import type { SubagentSummary } from '@shared/types'

export function formatAgentDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  if (m < 60) {
    const rem = Math.round(s % 60)
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`
  }
  const h = Math.floor(m / 60)
  return m % 60 > 0 ? `${h}h ${m % 60}m` : `${h}h`
}

/** Run time as Claude Code reported it, else the first-to-last timestamp span. */
export function subagentDurationMs(sub: SubagentSummary): number {
  if (sub.durationMs !== undefined) return sub.durationMs
  if (!sub.firstTimestamp || !sub.lastTimestamp) return 0
  const span = new Date(sub.lastTimestamp).getTime() - new Date(sub.firstTimestamp).getTime()
  return Number.isFinite(span) && span > 0 ? span : 0
}

export function SubagentCard({
  subagent,
  running,
}: {
  subagent: SubagentSummary
  running: boolean
}): React.JSX.Element {
  const meta = subagent.primaryModel ? getModelMeta(subagent.primaryModel) : null
  const totalTokens = subagent.totalInputTokens + subagent.totalOutputTokens
  const durationMs = subagentDurationMs(subagent)
  const durationHint =
    subagent.durationSource === 'reported'
      ? 'Run time reported by Claude Code'
      : 'First to last write of the sub-agent transcript; overstates an agent that was resumed later'

  return (
    <div
      className={cn(
        'rounded-md border bg-muted/20 px-2.5 py-2',
        running ? 'border-green-500/40' : 'border-border/50'
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {running && (
              <span
                className="block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 animate-pulse"
                aria-label="Running"
                title="Running"
              />
            )}
            <span
              className="truncate text-[11px] font-medium text-foreground"
              title={subagent.description ?? subagent.agentId}
            >
              {subagent.description ?? subagent.agentId}
            </span>
          </div>
          {subagent.description && (
            <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">
              {subagent.agentId}
            </p>
          )}
        </div>
        {meta && (
          <span
            className={`shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {subagent.agentType && (
          <span className="rounded-sm bg-violet-500/15 px-1 py-0.5 text-[10px] font-medium text-violet-500">
            {subagent.agentType}
          </span>
        )}
        {subagent.isBackground && (
          <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            background
          </span>
        )}
        {subagent.parentAgentId && (
          <span
            className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
            title={`Started by sub-agent ${subagent.parentAgentId}`}
          >
            <CornerDownRight className="h-2.5 w-2.5" />
            depth {subagent.spawnDepth ?? 2}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {durationMs > 0 && (
          <span className="inline-flex items-center gap-0.5" title={durationHint}>
            <Clock className="h-2.5 w-2.5" />
            {running ? 'running · ' : ''}
            {formatAgentDuration(durationMs)}
            {subagent.durationSource === 'span' && <span className="opacity-60">~</span>}
          </span>
        )}
        <span>{formatTokens(totalTokens)} tokens</span>
        <span>{subagent.messageCount} msgs</span>
        <span>{formatCost(subagent.estimatedCost)}</span>
      </div>
    </div>
  )
}
