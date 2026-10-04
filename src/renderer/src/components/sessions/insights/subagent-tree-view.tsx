import React from 'react'
import { Minus, Plus } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { isSubagentRunning } from '@shared/utils/live-session'
import { getModelMeta } from '@renderer/lib/model-meta'
import { cn } from '@renderer/lib/cn'
import {
  formatAgentDuration,
  subagentDurationMs,
} from '@renderer/components/sessions/subagent-card'
import {
  layoutSubagentGraph,
  type GraphSize,
  type SubagentTree,
  type SubagentTreeNode,
} from './subagent-tree'

const SIZE: GraphSize = { nodeWidth: 232, nodeHeight: 58, columnGap: 40, rowGap: 12 }
/** Room around the graph so the outermost boxes' borders and shadows show. */
const PAD = 8

/** What the left-most box says about the session itself. */
export interface SessionNodeInfo {
  title: string
  model?: string
  /** Estimated cost of the session's own responses, sub-agents excluded. */
  cost?: number
}

function nodeSubtitle(sub: SubagentTreeNode['sub']): string {
  const parts: string[] = []
  if (sub.agentType) parts.push(sub.agentType)
  const model = sub.primaryModel ? getModelMeta(sub.primaryModel).label : undefined
  if (model) parts.push(model)
  const ms = subagentDurationMs(sub)
  if (ms > 0) parts.push(`${formatAgentDuration(ms)}${sub.durationSource === 'span' ? '~' : ''}`)
  parts.push(formatCost(sub.estimatedCost))
  return parts.join(' · ')
}

function AgentBox({
  node,
  running,
  collapsed,
  onToggle,
  onOpen,
}: {
  node: SubagentTreeNode
  running: boolean
  collapsed: boolean
  onToggle: () => void
  onOpen: () => void
}): React.JSX.Element {
  const { sub } = node
  const hasChildren = node.children.length > 0
  const title = sub.description ?? sub.agentId
  return (
    <div className="relative h-full">
      <button
        type="button"
        onClick={onOpen}
        title={`${title}\n${nodeSubtitle(sub)}${hasChildren ? ` · branch ${formatCost(node.subtreeCost)} over ${node.subtreeRuns} runs` : ''}\nOpen this sub-agent’s conversation`}
        className={cn(
          'flex h-full w-full flex-col justify-center gap-0.5 rounded-lg border bg-card px-3 text-left shadow-sm transition-colors',
          'hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          running ? 'border-green-500/60' : 'border-border',
          node.orphan && 'border-dashed border-amber-500/60'
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'block h-2 w-2 shrink-0 rounded-full',
              running ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
            )}
            aria-label={running ? 'Running' : undefined}
          />
          <span className="truncate text-xs font-medium text-foreground">{title}</span>
          {sub.isBackground && (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[9px] text-muted-foreground">
              bg
            </span>
          )}
        </span>
        <span className="truncate pl-3.5 text-[10px] tabular-nums text-muted-foreground">
          {nodeSubtitle(sub)}
          {hasChildren && ` · branch ${formatCost(node.subtreeCost)}`}
          {node.orphan && ' · parent missing'}
        </span>
      </button>
      {hasChildren && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? `Show the ${node.subtreeRuns - 1} sub-agents it started`
              : 'Hide the sub-agents it started'
          }
          className="absolute -right-2.5 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background px-1 text-[10px] tabular-nums text-muted-foreground shadow-sm hover:text-foreground"
        >
          {collapsed ? (
            <>
              <Plus className="h-2.5 w-2.5" />
              {node.subtreeRuns - 1}
            </>
          ) : (
            <Minus className="h-2.5 w-2.5" />
          )}
        </button>
      )}
    </div>
  )
}

/**
 * The session and its sub-agents as a left-to-right graph: each sub-agent in
 * the column after the agent that started it, joined by a connector.
 */
export function SubagentTreeView({
  tree,
  session,
  now,
  onOpen,
}: {
  tree: SubagentTree
  session: SessionNodeInfo
  now: number
  onOpen: (agentId: string) => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const layout = React.useMemo(
    () => layoutSubagentGraph(tree.roots, collapsed, SIZE),
    [tree, collapsed]
  )
  const toggle = (agentId: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  const sessionModel = session.model ? getModelMeta(session.model).label : undefined

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

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border/60 bg-muted/20">
        <div
          className="relative"
          style={{ width: layout.width + PAD * 2, height: layout.height + PAD * 2 }}
        >
          <svg
            aria-hidden
            className="absolute inset-0 text-border"
            width={layout.width + PAD * 2}
            height={layout.height + PAD * 2}
          >
            {layout.edges.map((e, i) => {
              const midX = (e.from.x + e.to.x) / 2
              return (
                <path
                  key={i}
                  d={`M ${e.from.x + PAD} ${e.from.y + PAD} H ${midX + PAD} V ${e.to.y + PAD} H ${e.to.x + PAD}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              )
            })}
          </svg>

          {layout.nodes.map(({ node, x, y }) => (
            <div
              key={node ? node.sub.agentId : '__session'}
              className="absolute"
              style={{
                left: x + PAD,
                top: y + PAD,
                width: SIZE.nodeWidth,
                height: SIZE.nodeHeight,
              }}
            >
              {node ? (
                <AgentBox
                  node={node}
                  running={isSubagentRunning(node.sub, now)}
                  collapsed={collapsed.has(node.sub.agentId)}
                  onToggle={() => toggle(node.sub.agentId)}
                  onOpen={() => onOpen(node.sub.agentId)}
                />
              ) : (
                <div className="flex h-full flex-col justify-center gap-0.5 rounded-lg border border-border bg-background px-3 shadow-sm">
                  <span
                    className="truncate text-xs font-semibold text-foreground"
                    title={session.title}
                  >
                    {session.title}
                  </span>
                  <span className="truncate text-[10px] tabular-nums text-muted-foreground">
                    Session
                    {sessionModel && ` · ${sessionModel}`}
                    {session.cost !== undefined && ` · ${formatCost(session.cost)} own`}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
