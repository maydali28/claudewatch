import React from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatCost } from '@shared/utils'
import { cn } from '@renderer/lib/cn'
import { formatAgentDuration } from '@renderer/components/sessions/subagent-card'
import type { SubagentTree } from './subagent-tree'
import { buildTrace, tracePosition, type TraceRow } from './subagent-trace'

const INDENT_PX = 14
const NAME_COLUMN = 'w-[300px] shrink-0'
const COST_COLUMN = 'w-16 shrink-0 text-right'

function barClass(row: TraceRow): string {
  if (row.endSource === 'running') return 'bg-green-500/70 animate-pulse'
  // The parent waited for a foreground agent; a background one ran alongside it.
  return row.node.sub.isBackground
    ? 'bg-primary/20 ring-1 ring-inset ring-primary/60'
    : 'bg-primary/75'
}

function rowTitle(row: TraceRow): string {
  const { sub } = row.node
  const duration = formatAgentDuration(row.end - row.start)
  const how =
    row.endSource === 'running'
      ? 'still running'
      : row.endSource === 'span'
        ? 'first to last write, may overstate a resumed agent'
        : 'reported by Claude Code'
  return [
    sub.description ?? sub.agentId,
    `${format(new Date(row.start), 'HH:mm:ss')} → ${format(new Date(row.end), 'HH:mm:ss')} · ${duration} (${how})`,
    `${sub.isBackground ? 'Background' : 'Foreground'} · ${formatCost(sub.estimatedCost)}`,
    'Open this sub-agent’s conversation',
  ].join('\n')
}

/**
 * Sub-agents on the session's clock: each one's run as a bar, in tree order,
 * so what ran in parallel, what took longest and where the session waited
 * can be read off directly.
 */
export function SubagentTraceView({
  tree,
  now,
  onOpen,
}: {
  tree: SubagentTree
  now: number
  onOpen: (agentId: string) => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const trace = React.useMemo(() => buildTrace(tree.roots, collapsed, now), [tree, collapsed, now])
  const span = trace.end - trace.start
  const multiDay = new Date(trace.start).toDateString() !== new Date(trace.end).toDateString()
  const tickFormat = multiDay ? 'MMM d HH:mm' : span < 10 * 60_000 ? 'HH:mm:ss' : 'HH:mm'
  const toggle = (agentId: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })

  if (trace.rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No sub-agent has a start time to place.</p>
  }

  // Header labels that have room: a gap mark only while the breaks are few
  // (the hatched bands in the rows show them either way), and no tick closer
  // than MIN_LABEL_GAP to a gap mark or to the tick before it.
  const MIN_LABEL_GAP = 0.09
  const gapMarks = trace.gaps.length <= 4 ? trace.gaps : []
  const axisTicks: typeof trace.ticks = []
  for (const t of trace.ticks) {
    const nearGap = gapMarks.some((g) => Math.abs((g.from + g.to) / 2 - t.position) < MIN_LABEL_GAP)
    const prev = axisTicks[axisTicks.length - 1]
    if (!nearGap && (!prev || t.position - prev.position >= MIN_LABEL_GAP)) axisTicks.push(t)
  }

  // Idle stretches cut from the axis, shaded the same way in every row.
  const gapBand = {
    backgroundImage:
      'repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / 0.18) 0 2px, transparent 2px 6px)',
  }
  const gridlines = (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {trace.ticks.map((t) => (
        <span
          key={t.at}
          className="absolute top-0 bottom-0 border-l border-dashed border-border/70"
          style={{ left: `${t.position * 100}%` }}
        />
      ))}
      {trace.gaps.map((g) => (
        <span
          key={g.start}
          className="absolute top-0 bottom-0"
          style={{ left: `${g.from * 100}%`, width: `${(g.to - g.from) * 100}%`, ...gapBand }}
        />
      ))}
    </div>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-primary/75" />
          the agent that started it waited
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-primary/20 ring-1 ring-inset ring-primary/60" />
          ran in the background
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-green-500/70" />
          running now
        </span>
        <span className="ml-auto tabular-nums">
          {format(new Date(trace.start), 'MMM d, HH:mm')} · {formatAgentDuration(span)} from first
          start to last end
          {trace.gaps.length > 0 &&
            ` · ${trace.gaps.length} idle stretch${trace.gaps.length === 1 ? '' : 'es'} cut from the axis`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <div className="min-w-[760px]">
          {/* Time axis */}
          <div className="flex items-end border-b border-border/60 bg-muted/30 px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
            <span className={NAME_COLUMN}>Sub-agent</span>
            <div className="relative mx-2 h-4 flex-1">
              {axisTicks.map((t) => (
                <span
                  key={t.at}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${t.position * 100}%` }}
                >
                  {format(new Date(t.at), tickFormat)}
                </span>
              ))}
              {gapMarks.map((g) => (
                <span
                  key={g.start}
                  title={`Nothing ran for ${formatAgentDuration(g.end - g.start)}`}
                  className="absolute -translate-x-1/2 whitespace-nowrap rounded bg-background px-1 text-muted-foreground/80"
                  style={{ left: `${((g.from + g.to) / 2) * 100}%` }}
                >
                  ⋯ {formatAgentDuration(g.end - g.start)}
                </span>
              ))}
            </div>
            <span className={COST_COLUMN}>Cost</span>
          </div>

          <ul>
            {trace.rows.map((row) => {
              const { node } = row
              const { sub } = node
              const left = tracePosition(trace, row.start) * 100
              const width = tracePosition(trace, row.end) * 100 - left
              const hasChildren = node.children.length > 0
              const isCollapsed = collapsed.has(sub.agentId)
              const label = formatAgentDuration(row.end - row.start)
              return (
                <li
                  key={sub.agentId}
                  className="group flex items-center border-b border-border/30 px-2 last:border-0 hover:bg-accent/40"
                >
                  <div
                    className={cn(NAME_COLUMN, 'flex min-w-0 items-center gap-1 py-1.5')}
                    style={{ paddingLeft: (node.depth - 1) * INDENT_PX }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggle(sub.agentId)}
                        aria-expanded={!isCollapsed}
                        aria-label={
                          isCollapsed
                            ? 'Show the sub-agents it started'
                            : 'Hide the sub-agents it started'
                        }
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => onOpen(sub.agentId)}
                      title={rowTitle(row)}
                      className="min-w-0 truncate text-left text-xs text-foreground hover:underline"
                    >
                      {sub.description ?? sub.agentId}
                    </button>
                    {sub.agentType && (
                      <span className="shrink-0 rounded-sm bg-violet-500/15 px-1 text-[9px] text-violet-500">
                        {sub.agentType}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpen(sub.agentId)}
                    title={rowTitle(row)}
                    className="relative mx-2 h-7 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {gridlines}
                    <span
                      className={cn('absolute top-1.5 bottom-1.5 rounded-sm', barClass(row))}
                      style={{ left: `${left}%`, width: `max(${width}%, 3px)` }}
                    />
                    {/* Duration beside the bar, on whichever side has room. */}
                    <span
                      className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap px-1 text-[10px] tabular-nums text-muted-foreground"
                      style={
                        left + width > 80
                          ? { right: `${100 - left}%` }
                          : { left: `calc(${left + width}% + 2px)` }
                      }
                    >
                      {label}
                      {row.endSource === 'span' && '~'}
                    </span>
                  </button>

                  <span className={cn(COST_COLUMN, 'text-[11px] tabular-nums text-foreground')}>
                    {formatCost(sub.estimatedCost)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
