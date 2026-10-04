import React from 'react'
import { Wrench } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { parseMcpToolName } from '@shared/utils/mcp-tool-name'
import { summarizeMcpServers, summarizeTools } from '@shared/utils/tool-usage-summary'
import type { ResponseTimelinePoint, ToolUsageRow } from '@shared/types'
import { InsightSection, StatTiles, TH, formatChars, percent } from './insight-section'
import { SessionActivityCharts } from './session-activity-charts'

const COST_NOTE =
  'Cost is the estimated cost of the responses that made the calls, split evenly when a response called several tools. Tokens spent on MCP tool definitions can’t be attributed to a server.'

/** The session's Tools & MCPs view: tool and MCP server usage, then cost and context over time. */
export function SessionToolsTab({
  toolUsage,
  timeline,
}: {
  toolUsage: ToolUsageRow[]
  timeline: ResponseTimelinePoint[]
}): React.JSX.Element {
  const tools = React.useMemo(() => summarizeTools(toolUsage), [toolUsage])
  // Only the servers this session called: the configured list says nothing
  // about what one session used.
  const servers = React.useMemo(() => summarizeMcpServers(toolUsage), [toolUsage])

  const calls = tools.reduce((s, t) => s + t.calls, 0)
  const errors = tools.reduce((s, t) => s + t.errors, 0)
  const toolCost = tools.reduce((s, t) => s + t.costUsd, 0)
  const subagentCalls = tools.reduce((s, t) => s + t.subagentCalls, 0)

  return (
    <div className="space-y-4">
      <StatTiles
        tiles={[
          { label: 'Tool calls', value: calls.toLocaleString(), hint: 'parent and sub-agents' },
          {
            label: 'Error rate',
            value: calls > 0 ? percent(errors / calls) : '—',
            hint: `${errors.toLocaleString()} failed calls`,
          },
          {
            label: 'By sub-agents',
            value: calls > 0 ? percent(subagentCalls / calls) : '—',
            hint: `${subagentCalls.toLocaleString()} calls`,
          },
          { label: 'Cost of tool turns', value: formatCost(toolCost), hint: 'estimate' },
        ]}
      />

      {tools.length === 0 && servers.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No tool calls"
          description="Neither this session nor its sub-agents called a tool"
        />
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <InsightSection title={`Tools (${tools.length})`} note={COST_NOTE}>
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-xs tabular-nums">
                <thead>
                  <tr className="text-left">
                    <th className={TH}>Tool</th>
                    <th className={`${TH} pl-3 text-right`}>Calls</th>
                    <th className={`${TH} pl-3 text-right`}>Sub-agents</th>
                    <th className={`${TH} pl-3 text-right`}>Errors</th>
                    <th className={`${TH} pl-3 text-right`}>Result</th>
                    <th className={`${TH} pl-3 text-right`}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t) => {
                    const mcp = parseMcpToolName(t.tool)
                    return (
                      <tr key={t.tool} className="border-t border-border/40">
                        <td className="max-w-[14rem] truncate py-1.5 pr-3 font-mono" title={t.tool}>
                          {mcp ? (
                            <>
                              <span className="text-muted-foreground">{mcp.server} › </span>
                              {mcp.method}
                            </>
                          ) : (
                            t.tool
                          )}
                        </td>
                        <td className="py-1.5 pl-3 text-right">{t.calls.toLocaleString()}</td>
                        <td className="py-1.5 pl-3 text-right text-muted-foreground">
                          {t.subagentCalls > 0 ? t.subagentCalls.toLocaleString() : '—'}
                        </td>
                        <td
                          className={`py-1.5 pl-3 text-right ${t.errors > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                        >
                          {t.errors}
                        </td>
                        <td className="py-1.5 pl-3 text-right text-muted-foreground">
                          {formatChars(t.resultChars)}
                        </td>
                        <td className="py-1.5 pl-3 text-right">{formatCost(t.costUsd)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </InsightSection>

          <InsightSection
            title={`MCP servers (${servers.length})`}
            note="Servers this session or its sub-agents called"
          >
            {servers.length === 0 ? (
              <p className="text-xs text-muted-foreground">This session called no MCP server.</p>
            ) : (
              <div className="space-y-2">
                {servers.map((s) => (
                  <div
                    key={s.server}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-foreground" title={s.server}>
                        {s.server}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {`${s.toolsUsed} tool${s.toolsUsed === 1 ? '' : 's'} used · ${formatCost(s.costUsd)}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      <span
                        className={s.calls === 0 ? 'text-muted-foreground/60' : 'text-foreground'}
                      >
                        {s.calls.toLocaleString()} calls
                      </span>
                      {s.errors > 0 && (
                        <span className="ml-2 text-destructive">{s.errors} errors</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </InsightSection>
        </div>
      )}

      <SessionActivityCharts timeline={timeline} />
    </div>
  )
}
