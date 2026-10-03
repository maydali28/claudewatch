import React from 'react'
import { Bot } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { isSubagentRunning } from '@shared/utils/live-session'
import { summarizeAgentTypes } from '@shared/utils/tool-usage-summary'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { useNow } from '@renderer/hooks/use-now'
import {
  SubagentCard,
  formatAgentDuration,
  subagentDurationMs,
} from '@renderer/components/sessions/subagent-card'
import type { SubagentSummary } from '@shared/types'
import { InsightSection, StatTiles, TH, percent } from './insight-section'

/** The session's Sub-agents view: totals, cost by agent type, then every run. */
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
  const runTime = subagents.reduce((s, a) => s + subagentDurationMs(a), 0)
  const background = subagents.filter((s) => s.isBackground).length

  return (
    <div className="space-y-4">
      <StatTiles
        tiles={[
          {
            label: 'Runs',
            value: subagents.length.toLocaleString(),
            hint: background > 0 ? `${background} in the background` : 'all in the foreground',
          },
          { label: 'Running now', value: running },
          {
            label: 'Run time',
            value: runTime > 0 ? formatAgentDuration(runTime) : '—',
            hint: 'summed across runs',
          },
          { label: 'Est. cost', value: formatCost(cost), hint: 'all sub-agents' },
        ]}
      />

      <InsightSection title="Cost by agent type">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left">
              <th className={TH}>Type</th>
              <th className={`${TH} pl-4 text-right`}>Runs</th>
              <th className={`${TH} pl-4 text-right`}>Run time</th>
              <th className={`${TH} pl-4 text-right`}>Cost</th>
              <th className={`${TH} pl-4 text-right`}>Avg cost</th>
              <th className={`${TH} pl-4 text-right`}>Share</th>
            </tr>
          </thead>
          <tbody>
            {byType.map((t) => (
              <tr key={t.agentType} className="border-t border-border/40">
                <td className="py-1.5 pr-3 text-foreground">{t.agentType}</td>
                <td className="py-1.5 pl-4 text-right">{t.runs}</td>
                <td className="py-1.5 pl-4 text-right text-muted-foreground">
                  {t.durationMs > 0 ? formatAgentDuration(t.durationMs) : '—'}
                </td>
                <td className="py-1.5 pl-4 text-right">{formatCost(t.costUsd)}</td>
                <td className="py-1.5 pl-4 text-right text-muted-foreground">
                  {formatCost(t.costUsd / t.runs)}
                </td>
                <td className="py-1.5 pl-4 text-right text-muted-foreground">
                  {percent(cost > 0 ? t.costUsd / cost : 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightSection>

      <InsightSection title={`Runs (${subagents.length})`} note="Newest first">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
          {ordered.map((sub) => (
            <SubagentCard key={sub.agentId} subagent={sub} running={isSubagentRunning(sub, now)} />
          ))}
        </div>
      </InsightSection>
    </div>
  )
}
