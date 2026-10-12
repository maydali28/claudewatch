import React, { useState } from 'react'
import {
  Cloud,
  FolderOpen,
  Globe,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  X,
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { ScopeGroup } from './scope-group'
import { SourceChips } from './source-chips'
import {
  countMcpsByFilter,
  groupMcps,
  mcpFilterOf,
  mcpOriginNote,
  mcpTransport,
  type McpFilter,
  type McpGroup,
} from './mcp-labels'
import type { McpServerEntry } from '@shared/types'

const ICON = 'h-3.5 w-3.5 shrink-0'

/** The status dot before a server's name, and its tooltip. */
const STATUS_DOT: Record<string, { className: string; label: string }> = {
  connected: { className: 'bg-emerald-500', label: 'Connected' },
  failed: { className: 'bg-red-500', label: 'Connection failed' },
  'needs-auth': { className: 'bg-amber-500', label: 'Needs authentication' },
  unknown: { className: 'bg-muted-foreground/30', label: 'Status unknown' },
}

const GROUP_ICON: Record<McpGroup['kind'], React.ReactNode> = {
  user: <Globe className={cn(ICON, 'text-muted-foreground')} />,
  project: <FolderOpen className={cn(ICON, 'text-amber-500')} />,
  plugin: <Puzzle className={cn(ICON, 'text-violet-500')} />,
  connector: <Cloud className={cn(ICON, 'text-teal-500')} />,
  builtin: <Package className={cn(ICON, 'text-muted-foreground')} />,
}

/**
 * What the server runs or reaches: its command, its URL, or for a built-in
 * what provides it. A connector needs no line: its group already says claude.ai.
 */
function mcpTarget(mcp: McpServerEntry): string | null {
  if (mcp.command) return [mcp.command.split('/').pop(), ...mcp.args].join(' ')
  if (mcp.url) return mcp.url
  return mcp.level === 'connector' ? null : mcpOriginNote(mcp)
}

function McpItem({
  mcp,
  selectedId,
  onSelect,
}: {
  mcp: McpServerEntry
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const selected = selectedId === mcp.id
  const transport = mcpTransport(mcp)
  const target = mcpTarget(mcp)
  const dot = STATUS_DOT[mcp.status ?? 'unknown'] ?? STATUS_DOT.unknown
  return (
    <button
      onClick={() => onSelect(mcp.id)}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent',
        mcp.disabled && 'opacity-60'
      )}
    >
      <p className="flex items-center gap-1.5 min-w-0">
        <span
          role="img"
          aria-label={dot.label}
          title={dot.label}
          className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot.className)}
        />
        <span
          className={cn(
            'text-xs font-medium truncate',
            selected ? 'text-primary' : 'text-foreground'
          )}
        >
          {mcp.name}
        </span>
        {mcp.level === 'local' && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
            local
          </span>
        )}
        {mcp.disabled && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
            disabled
          </span>
        )}
        {transport && (
          <span className="ml-auto text-[9px] uppercase tracking-wider font-mono text-muted-foreground/60 shrink-0">
            {transport}
          </span>
        )}
      </p>
      {target && (
        <p
          className={cn(
            // pl-3: under the name, past the status dot and its gap.
            'pl-3 text-[10px] text-muted-foreground truncate mt-0.5 leading-relaxed',
            (mcp.command || mcp.url) && 'font-mono'
          )}
        >
          {target}
        </p>
      )}
    </button>
  )
}

export default function McpsSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const mcps = useConfigStore((s) => s.mcps)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedMcpId = useConfigStore((s) => s.selectedMcpId)
  const setSelectedMcp = useConfigStore((s) => s.setSelectedMcp)
  const [search, setSearch] = useState('')
  const sourceFilter = (useUIStore((s) => s.sourceFilters.mcps) ?? 'all') as McpFilter
  const setSourceFilter = useUIStore((s) => s.setSourceFilter)

  const q = search.toLowerCase()
  const searched = mcps.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.command ?? '').toLowerCase().includes(q) ||
      (m.url ?? '').toLowerCase().includes(q) ||
      (m.projectName ?? '').toLowerCase().includes(q) ||
      (m.pluginName ?? '').toLowerCase().includes(q)
  )
  const counts = countMcpsByFilter(searched)
  const filtered = searched.filter((m) => sourceFilter === 'all' || mcpFilterOf(m) === sourceFilter)
  const groups = groupMcps(filtered)
  const total = mcps.length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            MCPs
          </span>
          {total > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {total}
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

      {total > 0 && (
        <SourceChips<McpFilter>
          label="Filter MCP servers by source"
          value={sourceFilter}
          onChange={(v) => setSourceFilter('mcps', v)}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'user', label: 'User', count: counts.user },
            { value: 'project', label: 'Project', count: counts.project },
            { value: 'plugin', label: 'Plugin', count: counts.plugin },
            { value: 'connector', label: 'claude.ai', count: counts.connector },
            { value: 'builtin', label: 'Built-in', count: counts.builtin },
          ]}
        />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && total === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isLoading && total === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Server className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No MCP servers found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Add servers with claude mcp add, or a project&apos;s .mcp.json
            </p>
          </div>
        )}

        {!isLoading && total > 0 && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">
              {search ? (
                <>No matches for &quot;{search}&quot;</>
              ) : (
                'No MCP servers from this source'
              )}
            </p>
          </div>
        )}

        {groups.map((g) => (
          <ScopeGroup
            key={g.key}
            label={g.label}
            count={g.items.length}
            icon={GROUP_ICON[g.kind]}
            tags={g.disabled ? ['disabled'] : []}
            muted={g.disabled}
          >
            {g.items.map((m) => (
              <McpItem key={m.id} mcp={m} selectedId={selectedMcpId} onSelect={setSelectedMcp} />
            ))}
          </ScopeGroup>
        ))}
      </div>
    </div>
  )
}
