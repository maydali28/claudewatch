import { isSubagentRunning } from '@shared/utils/live-session'
import type { SubagentTreeNode } from './subagent-tree'

/** One bar of the trace: a sub-agent's run on the session's time axis. */
export interface TraceRow {
  node: SubagentTreeNode
  /** Epoch ms. */
  start: number
  end: number
  /**
   * `reported`: Claude Code's own run time. `span`: first to last write,
   * which overstates a resumed agent. `running`: still going, drawn up to now.
   */
  endSource: 'reported' | 'span' | 'running'
}

export interface TraceTick {
  at: number
  /** Where the tick sits on the axis, 0 to 1. */
  position: number
}

/** A stretch of the axis where at least one sub-agent was running. */
export interface TraceSegment {
  start: number
  end: number
  /** Where the segment begins and ends on the axis, 0 to 1. */
  from: number
  to: number
}

/** An idle stretch squeezed out of the axis, drawn as a narrow break. */
export interface TraceGap {
  start: number
  end: number
  /** The break's left and right edges on the axis, 0 to 1. */
  from: number
  to: number
}

export interface Trace {
  rows: TraceRow[]
  /** Epoch ms the axis starts and ends at. */
  start: number
  end: number
  ticks: TraceTick[]
  segments: TraceSegment[]
  gaps: TraceGap[]
}

/** Idle stretches longer than this, with no sub-agent running, are cut from the axis. */
export const IDLE_GAP_MS = 10 * 60 * 1000
/** Width each cut idle stretch keeps on the axis. */
const GAP_SHARE = 0.03

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const TICK_STEPS = [
  SECOND,
  5 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
]

/**
 * Evenly spaced ticks at a round step, about `target` of them, placed on an
 * axis that maps `start`..`end` to `from`..`to`.
 */
export function traceTicks(start: number, end: number, target = 6, from = 0, to = 1): TraceTick[] {
  const span = end - start
  if (!(span > 0) || target < 1) return []
  const step = TICK_STEPS.find((s) => span / s <= target) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const ticks: TraceTick[] = []
  for (let at = Math.ceil(start / step) * step; at <= end; at += step) {
    ticks.push({ at, position: from + ((at - start) / span) * (to - from) })
  }
  return ticks
}

/** Where `t` falls on the axis, 0 to 1, skipping the cut idle stretches. */
export function tracePosition(trace: Pick<Trace, 'segments'>, t: number): number {
  for (const seg of trace.segments) {
    if (t <= seg.end) {
      const within =
        seg.end > seg.start ? (Math.max(t, seg.start) - seg.start) / (seg.end - seg.start) : 0
      return seg.from + within * (seg.to - seg.from)
    }
  }
  return 1
}

function runOf(node: SubagentTreeNode, now: number): TraceRow | null {
  const { sub } = node
  const start = new Date(sub.firstTimestamp).getTime()
  if (!Number.isFinite(start)) return null
  if (isSubagentRunning(sub, now))
    return { node, start, end: Math.max(start, now), endSource: 'running' }
  if (sub.durationSource === 'reported' && sub.durationMs !== undefined) {
    return { node, start, end: start + sub.durationMs, endSource: 'reported' }
  }
  const last = new Date(sub.lastTimestamp).getTime()
  return {
    node,
    start,
    end: Number.isFinite(last) ? Math.max(start, last) : start,
    endSource: 'span',
  }
}

/**
 * The tree flattened into trace rows, each agent followed by the agents it
 * started (oldest first), skipping collapsed branches; and the time axis
 * spanning every row. An agent with no usable start time is left out.
 */
export function buildTrace(
  roots: readonly SubagentTreeNode[],
  collapsed: ReadonlySet<string>,
  now: number
): Trace {
  const rows: TraceRow[] = []
  const walk = (node: SubagentTreeNode): void => {
    const row = runOf(node, now)
    if (row) rows.push(row)
    if (!collapsed.has(node.sub.agentId)) node.children.forEach(walk)
  }
  roots.forEach(walk)
  if (rows.length === 0) return { rows, start: 0, end: 0, ticks: [], segments: [], gaps: [] }

  // Busy stretches: runs merged wherever they overlap or sit within
  // IDLE_GAP_MS of each other. What lies between two of them is idle.
  const sorted = [...rows].sort((a, b) => a.start - b.start)
  const busy: Array<{ start: number; end: number }> = []
  for (const r of sorted) {
    const last = busy[busy.length - 1]
    if (last && r.start - last.end <= IDLE_GAP_MS) last.end = Math.max(last.end, r.end)
    else busy.push({ start: r.start, end: r.end })
  }
  // A run that took no measurable time still needs an axis to sit on.
  for (const b of busy) b.end = Math.max(b.end, b.start + SECOND)

  const busyTotal = busy.reduce((sum, b) => sum + (b.end - b.start), 0)
  const gapCount = busy.length - 1
  const gapShare = Math.min(GAP_SHARE, 0.3 / Math.max(1, gapCount))
  const busyShare = 1 - gapShare * gapCount
  const segments: TraceSegment[] = []
  const gaps: TraceGap[] = []
  let cursor = 0
  busy.forEach((b, i) => {
    if (i > 0) {
      gaps.push({ start: busy[i - 1].end, end: b.start, from: cursor, to: cursor + gapShare })
      cursor += gapShare
    }
    const width = ((b.end - b.start) / busyTotal) * busyShare
    segments.push({ start: b.start, end: b.end, from: cursor, to: cursor + width })
    cursor += width
  })
  segments[segments.length - 1].to = 1

  const ticks = segments.flatMap((seg) =>
    traceTicks(seg.start, seg.end, Math.round(6 * (seg.to - seg.from)), seg.from, seg.to)
  )
  return {
    rows,
    start: busy[0].start,
    end: busy[busy.length - 1].end,
    ticks,
    segments,
    gaps,
  }
}
