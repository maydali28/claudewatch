import React from 'react'
import { formatCost } from '@shared/utils'
import { COST_ESTIMATE_NOTE_SHORT } from '@shared/constants/copy'
import { parseMcpToolName, mcpToolServerName } from '@shared/utils/mcp-tool-name'
import type { McpServerSummary } from '@shared/utils/tool-usage-summary'
import { StatCard } from '@renderer/components/analytics/stat-card'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import { ipc } from '@renderer/lib/ipc-client'
import type { AnalyticsData } from '@shared/types'

const COST_SHARE_NOTE =
  'Cost share is the estimated cost of the responses that made the calls, split evenly when a response called several tools, over the period’s total.'

function percent(value: number): string {
  if (value === 0) return '0%'
  if (value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}

/** Configured MCP server names across every scope Claude Code reads globally. */
function useConfiguredMcpNames(): string[] {
  const [names, setNames] = React.useState<string[]>([])
  React.useEffect(() => {
    let cancelled = false
    ipc.config
      .getMcps()
      .then((r) => {
        if (!cancelled && r.ok) setNames(r.data.map((m) => m.name))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return names
}

/** A single-hue magnitude bar: the share it stands for, in its own track. */
function ShareBar({ share }: { share: number }): React.JSX.Element {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary/70"
        style={{ width: `${Math.min(100, share * 100)}%` }}
      />
    </div>
  )
}

const TH = 'py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'

export function ToolsTab({ data }: { data: AnalyticsData }): React.JSX.Element {
  const { toolUsage, totalCost } = data
  const configured = useConfiguredMcpNames()
  const servers: McpServerSummary[] = React.useMemo(() => {
    const called = new Set(toolUsage.mcpServers.map((s) => s.server))
    const unused = [...new Set(configured.map(mcpToolServerName))]
      .filter((name) => !called.has(name))
      .sort()
      .map((server) => ({
        server,
        calls: 0,
        errors: 0,
        costUsd: 0,
        toolsUsed: 0,
        configured: true,
      }))
    const known = new Set(configured.map(mcpToolServerName))
    return [
      ...toolUsage.mcpServers.map((s) => ({ ...s, configured: known.has(s.server) })),
      ...unused,
    ]
  }, [toolUsage.mcpServers, configured])

  const errorRate = toolUsage.totalCalls > 0 ? toolUsage.totalErrors / toolUsage.totalCalls : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Tool calls"
          value={toolUsage.totalCalls.toLocaleString()}
          subtitle="parent and sub-agents"
        />
        <StatCard
          label="Error rate"
          value={percent(errorRate)}
          subtitle={`${toolUsage.totalErrors.toLocaleString()} failed calls`}
        />
        <StatCard
          label="Cost of tool turns"
          value={formatCost(toolUsage.toolCost)}
          subtitle={`${percent(totalCost > 0 ? toolUsage.toolCost / totalCost : 0)} of ${formatCost(totalCost)}`}
          info={COST_SHARE_NOTE}
        />
        <StatCard
          label="MCP servers called"
          value={String(toolUsage.mcpServers.length)}
          subtitle={`${servers.filter((s) => s.calls === 0).length} configured, never called`}
        />
      </div>

      <ChartCard title="Tools" description={`${COST_SHARE_NOTE} ${COST_ESTIMATE_NOTE_SHORT}`}>
        {toolUsage.tools.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tool calls in this period
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left">
                  <th className={TH}>Tool</th>
                  <th className={`${TH} text-right`}>Calls</th>
                  <th className={`${TH} text-right`}>By sub-agents</th>
                  <th className={`${TH} text-right`}>Errors</th>
                  <th className={`${TH} text-right`}>Error rate</th>
                  <th className={`${TH} text-right`}>Cost</th>
                  <th className={`${TH} w-40 pl-4`}>Cost share</th>
                </tr>
              </thead>
              <tbody>
                {toolUsage.tools.map((t) => {
                  const mcp = parseMcpToolName(t.tool)
                  return (
                    <tr key={t.tool} className="border-t border-border/40">
                      <td className="py-1.5 pr-2 font-mono">
                        {mcp ? (
                          <>
                            <span className="text-muted-foreground">{mcp.server} › </span>
                            {mcp.method}
                          </>
                        ) : (
                          t.tool
                        )}
                      </td>
                      <td className="py-1.5 text-right">{t.calls.toLocaleString()}</td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {percent(t.calls > 0 ? t.subagentCalls / t.calls : 0)}
                      </td>
                      <td
                        className={`py-1.5 text-right ${t.errors > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                      >
                        {t.errors.toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {percent(t.calls > 0 ? t.errors / t.calls : 0)}
                      </td>
                      <td className="py-1.5 text-right">{formatCost(t.costUsd)}</td>
                      <td className="py-1.5 pl-4">
                        <div className="flex items-center gap-2">
                          <ShareBar share={t.costShare} />
                          <span className="w-12 shrink-0 text-right text-muted-foreground">
                            {percent(t.costShare)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="MCP servers"
          description="Called servers, and configured ones nobody called in this period. Tokens spent on tool definitions can't be attributed to a server."
        >
          {servers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No MCP servers configured or called
            </p>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left">
                  <th className={TH}>Server</th>
                  <th className={`${TH} text-right`}>Tools</th>
                  <th className={`${TH} text-right`}>Calls</th>
                  <th className={`${TH} text-right`}>Error rate</th>
                  <th className={`${TH} text-right`}>Cost share</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.server} className="border-t border-border/40">
                    <td className="py-1.5 pr-2">
                      <span className="font-mono">{s.server}</span>
                      {s.calls === 0 && (
                        <span className="ml-2 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          unused
                        </span>
                      )}
                      {!s.configured && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          not in global config
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">{s.toolsUsed}</td>
                    <td className="py-1.5 text-right">{s.calls.toLocaleString()}</td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {s.calls > 0 ? percent(s.errors / s.calls) : '—'}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {percent(totalCost > 0 ? s.costUsd / totalCost : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>

        <ChartCard
          title="Sub-agents by type"
          description="Runs that started in this period, with their estimated cost and run time."
        >
          {toolUsage.agentTypes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No sub-agent runs in this period
            </p>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left">
                  <th className={TH}>Type</th>
                  <th className={`${TH} text-right`}>Runs</th>
                  <th className={`${TH} text-right`}>Cost</th>
                  <th className={`${TH} text-right`}>Avg cost</th>
                  <th className={`${TH} text-right`}>Cost share</th>
                </tr>
              </thead>
              <tbody>
                {toolUsage.agentTypes.map((t) => (
                  <tr key={t.agentType} className="border-t border-border/40">
                    <td className="py-1.5 pr-2">{t.agentType}</td>
                    <td className="py-1.5 text-right">{t.runs.toLocaleString()}</td>
                    <td className="py-1.5 text-right">{formatCost(t.costUsd)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {formatCost(t.runs > 0 ? t.costUsd / t.runs : 0)}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {percent(totalCost > 0 ? t.costUsd / totalCost : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
