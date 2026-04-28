import React, { useState } from 'react'
import { RefreshCw, Search, Server, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { McpServerEntry } from '@shared/types'

const TRANSPORT_DOT: Record<string, string> = {
  stdio: 'bg-emerald-500',
  sse: 'bg-sky-500',
  http: 'bg-orange-500',
}

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  failed: 'bg-red-500',
  unknown: 'bg-muted-foreground/40',
}

function statusDot(mcp: McpServerEntry): string {
  if (mcp.status) return STATUS_DOT[mcp.status] ?? STATUS_DOT.unknown
  const transport = mcp.type ?? (mcp.url ? 'sse' : 'stdio')
  return TRANSPORT_DOT[transport] ?? 'bg-muted-foreground/40'
}

export default function McpsSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const mcps = useConfigStore((s) => s.mcps)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedMcpId = useConfigStore((s) => s.selectedMcpId)
  const setSelectedMcp = useConfigStore((s) => s.setSelectedMcp)
  const [search, setSearch] = useState('')

  const filtered = mcps.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.command ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (m.url ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const connectedCount = mcps.filter((m) => m.status === 'connected').length
  const failedCount = mcps.filter((m) => m.status === 'failed').length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            MCPs
          </span>
          {mcps.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {mcps.length}
            </span>
          )}
        </div>
        <button
          onClick={() => loadAll()}
          disabled={isLoading}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 text-muted-foreground', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      {/* Status summary */}
      {mcps.length > 0 && (
        <div className="flex gap-3 px-3 py-1.5 border-b border-border/30">
          {connectedCount > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {connectedCount}
              </span>{' '}
              connected
            </span>
          )}
          {failedCount > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
              <span className="font-semibold text-red-600 dark:text-red-400">
                {failedCount}
              </span>{' '}
              failed
            </span>
          )}
        </div>
      )}

      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter MCP servers…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading && mcps.length === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}

        {!isLoading && mcps.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Server className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No MCP servers configured</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Add mcpServers to ~/.claude/settings.json
            </p>
          </div>
        )}

        {!isLoading && mcps.length > 0 && filtered.length === 0 && search && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">No matches for &quot;{search}&quot;</p>
          </div>
        )}

        {filtered.map((mcp) => {
          const transport = mcp.type ?? (mcp.url ? 'sse' : 'stdio')
          const isSelected = selectedMcpId === mcp.id
          return (
            <button
              key={mcp.id}
              onClick={() => setSelectedMcp(mcp.id)}
              className={cn(
                'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusDot(mcp))} />
                <p
                  className={cn(
                    'text-xs font-medium truncate flex-1',
                    isSelected ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {mcp.name}
                </p>
                {mcp.level && (
                  <span className="shrink-0 text-[9px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                    {mcp.level}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 pl-3">
                <span className="text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wide shrink-0">
                  {transport}
                </span>
                <span className="text-muted-foreground/30 text-[10px]">·</span>
                {mcp.status === 'failed' ? (
                  <span className="text-[10px] text-red-500 truncate">connection failed</span>
                ) : mcp.command ? (
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    {mcp.command.split('/').pop()}
                  </p>
                ) : mcp.url ? (
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{mcp.url}</p>
                ) : null}
                {mcp.args.length > 0 && mcp.status !== 'failed' && (
                  <span className="shrink-0 text-[9px] text-muted-foreground/60">
                    {mcp.args.length} arg{mcp.args.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
