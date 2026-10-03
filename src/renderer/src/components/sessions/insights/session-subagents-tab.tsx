import React from 'react'
import { Bot } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { isSubagentRunning } from '@shared/utils/live-session'
import { summarizeAgentTypes } from '@shared/utils/tool-usage-summary'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { useNow } from '@renderer/hooks/use-now'
import type { SubagentSummary } from '@shared/types'
import { SubagentCard, formatAgentDuration } from '@renderer/components/sessions/subagent-card'
import { InsightSection, StatTiles } from './insight-section'

export function SessionSubagentsTab({
  subagents,
}: {
  subagents: SubagentSummary[]
}): React.JSX.Element {
  const now = useNow(subagents.length > 0)
  const byType = React.useMemo(() => summarizeAgentTypes(subagents), [subagents])
  // Newest first: the one that just started or is still running is on top.
  const ordered = React.useMemo(
    () => [...subagents].sort((a, b) => b.firstTimestamp.localeCompare(a.firstTimestamp)),
    [subagents]
  )

  if (subagents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No sub-agents"
        description="This session did not start any sub-agents"
      />
    )
  }

  const running = subagents.filter((s) => isSubagentRunning(s, now)).length
  const cost = subagents.reduce((s, a) => s + a.estimatedCost, 0)

  return (
    <div>
      <StatTiles
        tiles={[
          { label: 'Runs', value: subagents.length },
          { label: 'Running', value: running },
          { label: 'Est. cost', value: formatCost(cost) },
        ]}
      />

      <InsightSection title="Cost by agent type">
        <table className="w-full table-fixed text-[10px] tabular-nums">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 font-medium">Type</th>
              <th className="w-9 py-1 text-right font-medium">Runs</th>
              <th className="w-14 py-1 text-right font-medium">Time</th>
              <th className="w-12 py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {byType.map((t) => (
              <tr key={t.agentType} className="border-t border-border/30">
                <td className="truncate py-1 pr-1 text-foreground" title={t.agentType}>
                  {t.agentType}
                </td>
                <td className="py-1 text-right">{t.runs}</td>
                <td className="py-1 text-right text-muted-foreground">
                  {t.durationMs > 0 ? formatAgentDuration(t.durationMs) : '—'}
                </td>
                <td className="py-1 text-right">{formatCost(t.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightSection>

      <InsightSection title={`Runs (${subagents.length})`}>
        <div className="space-y-1.5">
          {ordered.map((sub) => (
            <SubagentCard key={sub.agentId} subagent={sub} running={isSubagentRunning(sub, now)} />
          ))}
        </div>
      </InsightSection>
    </div>
  )
}
