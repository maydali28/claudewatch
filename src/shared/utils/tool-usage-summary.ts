import type { SubagentSummary, ToolUsageRow } from '@shared/types/session'
import { mcpToolServerName } from './mcp-tool-name'

export interface ToolSummary {
  tool: string
  mcpServer?: string
  calls: number
  /** Of `calls`, the ones made by sub-agents. */
  subagentCalls: number
  errors: number
  resultChars: number
  costUsd: number
}

export interface McpServerSummary {
  /** The server name as tool names spell it. */
  server: string
  calls: number
  errors: number
  costUsd: number
  /** Distinct tools of this server that were called. */
  toolsUsed: number
  /** Found in the MCP configuration that applies here. */
  configured: boolean
}

export interface AgentTypeSummary {
  agentType: string
  runs: number
  costUsd: number
  durationMs: number
}

/** One row per tool across days and sides, most-called first. */
export function summarizeTools(rows: readonly ToolUsageRow[]): ToolSummary[] {
  const byTool = new Map<string, ToolSummary>()
  for (const row of rows) {
    let s = byTool.get(row.tool)
    if (!s) {
      s = {
        tool: row.tool,
        calls: 0,
        subagentCalls: 0,
        errors: 0,
        resultChars: 0,
        costUsd: 0,
        ...(row.mcpServer ? { mcpServer: row.mcpServer } : {}),
      }
      byTool.set(row.tool, s)
    }
    s.calls += row.calls
    if (row.source === 'subagent') s.subagentCalls += row.calls
    s.errors += row.errors
    s.resultChars += row.resultChars
    s.costUsd += row.costUsd
  }
  return [...byTool.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))
}

/**
 * One row per MCP server: every server that was called, plus every
 * configured one, so a configured server nobody called shows with zero calls.
 */
export function summarizeMcpServers(
  rows: readonly ToolUsageRow[],
  configuredNames: readonly string[] = []
): McpServerSummary[] {
  const configured = new Set(configuredNames.map(mcpToolServerName))
  const byServer = new Map<string, McpServerSummary & { tools: Set<string> }>()
  const get = (server: string): McpServerSummary & { tools: Set<string> } => {
    let s = byServer.get(server)
    if (!s) {
      s = {
        server,
        calls: 0,
        errors: 0,
        costUsd: 0,
        toolsUsed: 0,
        configured: configured.has(server),
        tools: new Set(),
      }
      byServer.set(server, s)
    }
    return s
  }
  for (const row of rows) {
    if (!row.mcpServer) continue
    const s = get(row.mcpServer)
    s.calls += row.calls
    s.errors += row.errors
    s.costUsd += row.costUsd
    s.tools.add(row.tool)
  }
  for (const server of configured) get(server)
  return [...byServer.values()]
    .map(({ tools, ...s }) => ({ ...s, toolsUsed: tools.size }))
    .sort((a, b) => b.calls - a.calls || a.server.localeCompare(b.server))
}

/** Sub-agent runs grouped by `agentType`, costliest first. No type: `unknown`. */
export function summarizeAgentTypes(subagents: readonly SubagentSummary[]): AgentTypeSummary[] {
  const byType = new Map<string, AgentTypeSummary>()
  for (const sub of subagents) {
    const agentType = sub.agentType ?? 'unknown'
    const s = byType.get(agentType) ?? { agentType, runs: 0, costUsd: 0, durationMs: 0 }
    s.runs++
    s.costUsd += sub.estimatedCost
    s.durationMs += sub.durationMs ?? 0
    byType.set(agentType, s)
  }
  return [...byType.values()].sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs)
}
