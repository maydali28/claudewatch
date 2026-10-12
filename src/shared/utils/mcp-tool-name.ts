/**
 * Split an MCP tool name, `mcp__<server>__<method>`, into its parts. Server
 * names never contain `__`; methods may. Not an MCP tool: undefined.
 */
export function parseMcpToolName(tool: string): { server: string; method: string } | undefined {
  if (!tool.startsWith('mcp__')) return undefined
  const rest = tool.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0 || sep + 2 >= rest.length) return undefined
  return { server: rest.slice(0, sep), method: rest.slice(sep + 2) }
}

/**
 * The server name as it appears in tool names. Claude Code replaces every
 * character outside `[A-Za-z0-9_-]` with `_` when it builds them, so a
 * configured `my.server` is called as `mcp__my_server__…`.
 */
export function mcpToolServerName(configuredName: string): string {
  return configuredName.replace(/[^A-Za-z0-9_-]/g, '_')
}
