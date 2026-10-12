import { mcpToolServerName, parseMcpToolName } from '@shared/utils/mcp-tool-name'
import type { McpServerEntry, ToolSummary } from '@shared/types'

/** The badge text for a server's level. */
export function mcpLevelLabel(level: McpServerEntry['level']): string {
  if (level === 'connector') return 'claude.ai'
  if (level === 'builtin') return 'built-in'
  return level ?? 'unknown'
}

/** Transport, or null for connectors and built-ins, which have no config to read it from. */
export function mcpTransport(mcp: McpServerEntry): string | null {
  if (mcp.type) return mcp.type
  if (mcp.url) return 'sse'
  if (mcp.command) return 'stdio'
  return null
}

/** One line on where the server comes from, for servers without a command or URL. */
export function mcpOriginNote(mcp: McpServerEntry): string | null {
  if (mcp.level === 'connector') return 'claude.ai connector'
  if (mcp.level === 'builtin') {
    if (mcp.name === 'claude-in-chrome') return 'Claude in Chrome extension'
    if (mcp.name === 'claude-vscode') return 'Claude Code IDE extension'
    return 'Built into Claude Code'
  }
  return null
}

// ─── Sidebar groups ───────────────────────────────────────────────────────────

/** The source chips above the MCP sidebar. A project's `local` servers count as Project. */
export type McpFilter = 'all' | 'user' | 'project' | 'plugin' | 'connector' | 'builtin'

export function mcpFilterOf(mcp: McpServerEntry): Exclude<McpFilter, 'all'> {
  switch (mcp.level) {
    case 'project':
    case 'local':
      return 'project'
    case 'plugin':
    case 'connector':
    case 'builtin':
      return mcp.level
    default:
      return 'user'
  }
}

export function countMcpsByFilter(mcps: McpServerEntry[]): Record<McpFilter, number> {
  const counts: Record<McpFilter, number> = {
    all: mcps.length,
    user: 0,
    project: 0,
    plugin: 0,
    connector: 0,
    builtin: 0,
  }
  for (const mcp of mcps) counts[mcpFilterOf(mcp)]++
  return counts
}

export interface McpGroup {
  key: string
  label: string
  kind: Exclude<McpFilter, 'all'>
  /** Every server in a plugin group is disabled with its plugin. */
  disabled: boolean
  items: McpServerEntry[]
}

const GROUP_RANK: Record<McpGroup['kind'], number> = {
  user: 0,
  project: 1,
  plugin: 2,
  connector: 3,
  builtin: 4,
}

/**
 * Servers grouped the way the setup sidebars group items: Global, then each
 * project (its `project` and `local` servers together), then each plugin
 * (projects and plugins alphabetically), then claude.ai connectors, then
 * Built-in. Servers keep their order within a group.
 */
export function groupMcps(mcps: McpServerEntry[]): McpGroup[] {
  const groups = new Map<string, McpGroup>()
  for (const mcp of mcps) {
    const kind = mcpFilterOf(mcp)
    const key =
      kind === 'project'
        ? `project:${mcp.projectId ?? mcp.projectName ?? ''}`
        : kind === 'plugin'
          ? `plugin:${mcp.pluginName ?? ''}`
          : kind
    let group = groups.get(key)
    if (!group) {
      const label =
        kind === 'user'
          ? 'Global'
          : kind === 'project'
            ? (mcp.projectName ?? 'Project')
            : kind === 'plugin'
              ? (mcp.pluginName ?? 'Plugin')
              : kind === 'connector'
                ? 'claude.ai'
                : 'Built-in'
      group = { key, label, kind, disabled: true, items: [] }
      groups.set(key, group)
    }
    group.items.push(mcp)
    if (!mcp.disabled) group.disabled = false
  }
  return [...groups.values()]
    .map((g) => (g.kind === 'plugin' ? g : { ...g, disabled: false }))
    .sort(
      (a, b) =>
        GROUP_RANK[a.kind] - GROUP_RANK[b.kind] ||
        a.label.toLowerCase().localeCompare(b.label.toLowerCase())
    )
}

// ─── Details page ─────────────────────────────────────────────────────────────

export interface McpToolRow {
  /** The tool's own name, without the `mcp__<server>__` prefix. */
  name: string
  /** Offered when the server last connected. */
  available: boolean
  calls: number
  errors: number
  costUsd: number
}

/**
 * The server's tools: every tool it offered when it last connected, plus any
 * tool it was called through in the period that it no longer offers, each
 * with its calls, errors and cost. Most-called first, then by name.
 */
export function mcpToolRows(mcp: McpServerEntry, usage: readonly ToolSummary[]): McpToolRow[] {
  const server = mcpToolServerName(mcp.name)
  const rows = new Map<string, McpToolRow>()
  for (const name of mcp.tools ?? []) {
    rows.set(name, { name, available: true, calls: 0, errors: 0, costUsd: 0 })
  }
  for (const u of usage) {
    const parsed = parseMcpToolName(u.tool)
    if (!parsed || parsed.server !== server) continue
    const row = rows.get(parsed.method) ?? {
      name: parsed.method,
      available: false,
      calls: 0,
      errors: 0,
      costUsd: 0,
    }
    row.calls += u.calls
    row.errors += u.errors
    row.costUsd += u.costUsd
    rows.set(parsed.method, row)
  }
  return [...rows.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

/** The `-s` scope `claude mcp` uses for a server, or null when it cannot manage it. */
function cliScope(mcp: McpServerEntry): string | null {
  const file = mcp.sourcePath ?? ''
  if (!/(^|[\\/])\.claude\.json$|(^|[\\/])\.mcp\.json$/.test(file)) return null
  if (mcp.level === 'global') return 'user'
  if (mcp.level === 'project' || mcp.level === 'local') return mcp.level
  return null
}

/**
 * `claude mcp` commands for a server defined where the CLI manages servers
 * (`~/.claude.json` or a project's `.mcp.json`); none for servers from
 * settings files, plugins, claude.ai or Claude Code itself.
 */
export function mcpCliCommands(mcp: McpServerEntry): { label: string; command: string }[] {
  const scope = cliScope(mcp)
  if (!scope) return []
  const name = /^[A-Za-z0-9_.-]+$/.test(mcp.name) ? mcp.name : JSON.stringify(mcp.name)
  return [
    { label: 'Inspect', command: `claude mcp get ${name}` },
    { label: 'Remove', command: `claude mcp remove ${name} -s ${scope}` },
  ]
}
