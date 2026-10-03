import React from 'react'
import { ChevronDown, ChevronRight, Clock, MessageSquare } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { isSubagentRunning } from '@shared/utils/live-session'
import { getModelMeta } from '@renderer/lib/model-meta'
import { cn } from '@renderer/lib/cn'
import {
  formatAgentDuration,
  subagentDurationMs,
} from '@renderer/components/sessions/subagent-card'
import type { SubagentTree, SubagentTreeNode } from './subagent-tree'

/** Pixels each level is indented by. */
const INDENT_PX = 20

function TreeRow({
  node,
  now,
  collapsed,
  onToggle,
  onOpen,
}: {
  node: SubagentTreeNode
  now: number
  collapsed: Set<string>
  onToggle: (agentId: string) => void
  onOpen: (agentId: string) => void
}): React.JSX.Element {
  const { sub } = node
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(sub.agentId)
  const running = isSubagentRunning(sub, now)
  const meta = sub.primaryModel ? getModelMeta(sub.primaryModel) : null
  const durationMs = subagentDurationMs(sub)

  return (
    <li>
      <div
        className="group relative flex items-center gap-1.5 rounded-md py-1.5 pr-2 hover:bg-accent/50"
        style={{ paddingLeft: (node.depth - 1) * INDENT_PX + 4 }}
      >
        {/* Guide line from the parent down to this row. */}
        {node.depth > 1 && (
          <span
            aria-hidden
            className="absolute top-0 bottom-0 border-l border-border"
            style={{ left: (node.depth - 2) * INDENT_PX + 12 }}
          />
        )}
        <button
          type="button"
          onClick={() => onToggle(sub.agentId)}
          disabled={!hasChildren}
          aria-label={
            isCollapsed ? 'Show the sub-agents it started' : 'Hide the sub-agents it started'
          }
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground',
            hasChildren ? 'hover:bg-accent hover:text-foreground' : 'invisible'
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onOpen(sub.agentId)}
          title="Open this sub-agent’s conversation"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {running && (
            <span
              className="block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 animate-pulse"
              aria-label="Running"
            />
          )}
          <span className="truncate text-xs font-medium text-foreground">
            {sub.description ?? sub.agentId}
          </span>
          {sub.agentType && (
            <span className="shrink-0 rounded-sm bg-violet-500/15 px-1 py-0.5 text-[10px] font-medium text-violet-500">
              {sub.agentType}
            </span>
          )}
          {sub.isBackground && (
            <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              background
            </span>
          )}
          {node.orphan && (
            <span
              className="shrink-0 rounded-sm bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-600"
              title={`Started by sub-agent ${sub.parentAgentId}, whose transcript is gone`}
            >
              parent missing
            </span>
          )}
          {meta && (
            <span
              className={`shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
            >
              {meta.label}
            </span>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
          {durationMs > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatAgentDuration(durationMs)}
              {sub.durationSource === 'span' && '~'}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {sub.messageCount}
          </span>
          <span className="w-14 text-right text-foreground">{formatCost(sub.estimatedCost)}</span>
          {/* Descendants' cost only matters when there are descendants. */}
          <span
            className="w-24 text-right"
            title={hasChildren ? `${node.subtreeRuns} runs in this branch` : undefined}
          >
            {hasChildren ? `${formatCost(node.subtreeCost)} branch` : ''}
          </span>
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.sub.agentId}
              node={child}
              now={now}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Sub-agents nested under the agent that started them, oldest first. */
export function SubagentTreeView({
  tree,
  now,
  onOpen,
}: {
  tree: SubagentTree
  now: number
  onOpen: (agentId: string) => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const toggle = React.useCallback((agentId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {tree.levels.map((level) => (
          <span
            key={level.depth}
            className="rounded-md border border-border/60 px-2 py-1 text-[11px] tabular-nums text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              {level.depth === 1 ? 'Started by the session' : `Depth ${level.depth}`}
            </span>{' '}
            · {level.runs} run{level.runs === 1 ? '' : 's'} · {formatCost(level.cost)}
          </span>
        ))}
      </div>
      <ul aria-label="Sub-agents by who started them" className="space-y-0.5">
        {tree.roots.map((node) => (
          <TreeRow
            key={node.sub.agentId}
            node={node}
            now={now}
            collapsed={collapsed}
            onToggle={toggle}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  )
}
