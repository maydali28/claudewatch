import React from 'react'
import { Wrench } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { ipc } from '@renderer/lib/ipc-client'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { parseMcpToolName } from '@shared/utils/mcp-tool-name'
import { summarizeMcpServers, summarizeTools } from '@shared/utils/tool-usage-summary'
import type { ToolUsageRow } from '@shared/types'
import { InsightSection, StatTiles, formatChars } from './insight-section'

const COST_NOTE =
  "Cost is the estimated cost of the responses that made the calls, split evenly when a response called several tools. Tokens spent on MCP tool definitions can't be attributed to a server."

/** Names of the MCP servers configured for this project, globally or in it. */
function useConfiguredMcpNames(projectId: string): string[] {
  const [names, setNames] = React.useState<string[]>([])
  React.useEffect(() => {
    let cancelled = false
    ipc.config
      .getMcps(projectId)
      .then((result) => {
        if (!cancelled && result.ok) setNames(result.data.map((m) => m.name))
      })
      .catch(() => {
        // The list still shows every server that was called.
      })
    return () => {
      cancelled = true
    }
  }, [projectId])
  return names
}

function ErrorCount({ errors }: { errors: number }): React.JSX.Element {
  return (
    <span className={errors > 0 ? 'text-destructive' : 'text-muted-foreground/50'}>{errors}</span>
  )
}

export function SessionToolsTab({
  projectId,
  toolUsage,
}: {
  projectId: string
  toolUsage: ToolUsageRow[]
}): React.JSX.Element {
  const configuredMcps = useConfiguredMcpNames(projectId)
  const tools = React.useMemo(() => summarizeTools(toolUsage), [toolUsage])
  const servers = React.useMemo(
    () => summarizeMcpServers(toolUsage, configuredMcps),
    [toolUsage, configuredMcps]
  )

  if (tools.length === 0 && servers.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No tool calls"
        description="Neither this session nor its sub-agents called a tool"
      />
    )
  }

  const calls = tools.reduce((s, t) => s + t.calls, 0)
  const errors = tools.reduce((s, t) => s + t.errors, 0)

  return (
    <div>
      <StatTiles
        tiles={[
          { label: 'Calls', value: calls },
          { label: 'Errors', value: errors },
          {
            label: 'Error rate',
            value: calls > 0 ? `${((errors / calls) * 100).toFixed(1)}%` : '—',
          },
        ]}
      />

      <InsightSection title={`Tools (${tools.length})`} note="Parent session and sub-agents">
        <table className="w-full table-fixed text-[10px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 font-medium">Tool</th>
              <th className="w-9 py-1 text-right font-medium">Calls</th>
              <th className="w-6 py-1 text-right font-medium">Err</th>
              <th className="w-12 py-1 text-right font-medium">Result</th>
              <th className="w-11 py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {tools.map((t) => {
              const mcp = parseMcpToolName(t.tool)
              return (
                <tr key={t.tool} className="border-t border-border/30">
                  <td className="py-1 pr-1">
                    <span
                      className="block truncate font-mono text-foreground"
                      title={
                        t.subagentCalls > 0
                          ? `${t.tool} · ${t.subagentCalls} of ${t.calls} calls by sub-agents`
                          : t.tool
                      }
                    >
                      {/* The panel is narrow: the method is what tells calls apart,
                          and the MCP servers list below names the server. */}
                      {mcp ? mcp.method : t.tool}
                    </span>
                  </td>
                  <td className="py-1 text-right">{t.calls}</td>
                  <td className="py-1 text-right">
                    <ErrorCount errors={t.errors} />
                  </td>
                  <td className="py-1 text-right text-muted-foreground">
                    {formatChars(t.resultChars)}
                  </td>
                  <td className="py-1 text-right text-muted-foreground">{formatCost(t.costUsd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </InsightSection>

      <InsightSection
        title={`MCP servers (${servers.length})`}
        note="Called servers, and configured ones this session never called"
      >
        {servers.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">No MCP servers configured or called.</p>
        ) : (
          <div className="space-y-1">
            {servers.map((s) => (
              <div
                key={s.server}
                className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-2 py-1"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[10px] text-foreground" title={s.server}>
                    {s.server}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {s.calls === 0
                      ? 'not called'
                      : `${s.toolsUsed} tool${s.toolsUsed === 1 ? '' : 's'} · ${formatCost(s.costUsd)}`}
                    {!s.configured && ' · not in this project’s MCP config'}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[10px] tabular-nums">
                  <span className={s.calls === 0 ? 'text-muted-foreground/50' : 'text-foreground'}>
                    {s.calls} calls
                  </span>
                  {s.errors > 0 && <span className="ml-1 text-destructive">{s.errors} err</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </InsightSection>
      <p className="mt-3 text-[9px] leading-snug text-muted-foreground/70">{COST_NOTE}</p>
    </div>
  )
}
