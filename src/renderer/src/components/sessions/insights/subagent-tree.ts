import type { SubagentSummary } from '@shared/types'
import { compareTimestampsAscending } from '@shared/utils/date-ranges'

/** One sub-agent in the tree, with what it started beneath it. */
export interface SubagentTreeNode {
  sub: SubagentSummary
  /** 1 for a sub-agent of the session, 2 for one of its sub-agents, … */
  depth: number
  children: SubagentTreeNode[]
  /** This agent's cost plus every descendant's. */
  subtreeCost: number
  /** This agent plus every descendant. */
  subtreeRuns: number
  /**
   * The meta file names a parent agent that is not among this session's
   * sub-agents (its transcript is gone), so the node is shown at the top.
   */
  orphan: boolean
}

export interface SubagentLevel {
  depth: number
  runs: number
  cost: number
}

export interface SubagentTree {
  roots: SubagentTreeNode[]
  /** Runs and cost per depth, shallowest first. */
  levels: SubagentLevel[]
}

/**
 * Nest sub-agents under the agent that started them (`parentAgentId` from the
 * meta file); the rest sit directly under the session. Siblings run oldest
 * first, so the tree reads in the order the work happened. A parent cycle,
 * which a well-formed transcript never has, is broken by treating the agent
 * that closes it as a root.
 */
export function buildSubagentTree(subagents: readonly SubagentSummary[]): SubagentTree {
  const byId = new Map(subagents.map((s) => [s.agentId, s]))
  const childrenOf = new Map<string, SubagentSummary[]>()
  const roots: SubagentSummary[] = []
  const orphans = new Set<string>()

  const formsCycle = (sub: SubagentSummary): boolean => {
    const seen = new Set<string>([sub.agentId])
    let parentId = sub.parentAgentId
    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) return true
      seen.add(parentId)
      parentId = byId.get(parentId)!.parentAgentId
    }
    return false
  }

  for (const sub of subagents) {
    const parentId = sub.parentAgentId
    if (!parentId) {
      roots.push(sub)
    } else if (!byId.has(parentId)) {
      orphans.add(sub.agentId)
      roots.push(sub)
    } else if (formsCycle(sub)) {
      roots.push(sub)
    } else {
      const list = childrenOf.get(parentId) ?? []
      list.push(sub)
      childrenOf.set(parentId, list)
    }
  }

  const byStart = (a: SubagentSummary, b: SubagentSummary): number =>
    compareTimestampsAscending(a.firstTimestamp, b.firstTimestamp)
  const levels = new Map<number, SubagentLevel>()

  const build = (sub: SubagentSummary, depth: number): SubagentTreeNode => {
    const level = levels.get(depth) ?? { depth, runs: 0, cost: 0 }
    level.runs++
    level.cost += sub.estimatedCost
    levels.set(depth, level)
    const children = (childrenOf.get(sub.agentId) ?? [])
      .sort(byStart)
      .map((c) => build(c, depth + 1))
    return {
      sub,
      depth,
      children,
      subtreeCost: sub.estimatedCost + children.reduce((s, c) => s + c.subtreeCost, 0),
      subtreeRuns: 1 + children.reduce((s, c) => s + c.subtreeRuns, 0),
      orphan: orphans.has(sub.agentId),
    }
  }

  return {
    roots: [...roots].sort(byStart).map((r) => build(r, 1)),
    levels: [...levels.values()].sort((a, b) => a.depth - b.depth),
  }
}

// ─── Graph layout ─────────────────────────────────────────────────────────────

export interface GraphSize {
  nodeWidth: number
  nodeHeight: number
  /** Horizontal space between a parent's column and its children's. */
  columnGap: number
  /** Vertical space between two neighbouring nodes. */
  rowGap: number
}

export interface PlacedNode {
  /** Null for the session itself, at the left. */
  node: SubagentTreeNode | null
  x: number
  y: number
}

export interface GraphEdge {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface GraphLayout {
  nodes: PlacedNode[]
  edges: GraphEdge[]
  width: number
  height: number
}

/**
 * Left-to-right layout: the session in column 0, each depth one column to the
 * right. Leaves take consecutive rows top to bottom and every parent sits
 * level with its first child, so a branch never crosses another and a wide
 * fan-out keeps its parent at the top instead of half a screen down. A collapsed
 * node is laid out as a leaf. Edges run from a parent's right edge to its
 * child's left edge, both at mid-height.
 */
export function layoutSubagentGraph(
  roots: readonly SubagentTreeNode[],
  collapsed: ReadonlySet<string>,
  size: GraphSize
): GraphLayout {
  const { nodeWidth, nodeHeight, columnGap, rowGap } = size
  const nodes: PlacedNode[] = []
  const edges: GraphEdge[] = []
  let nextRow = 0
  const rowY = (row: number): number => row * (nodeHeight + rowGap)
  const columnX = (depth: number): number => depth * (nodeWidth + columnGap)

  // Returns the y of the placed node.
  const place = (node: SubagentTreeNode): number => {
    const x = columnX(node.depth)
    const open = node.children.length > 0 && !collapsed.has(node.sub.agentId)
    let y: number
    if (!open) {
      y = rowY(nextRow++)
    } else {
      const childYs = node.children.map(place)
      y = childYs[0]
      for (const childY of childYs) {
        edges.push({
          from: { x: x + nodeWidth, y: y + nodeHeight / 2 },
          to: { x: columnX(node.depth + 1), y: childY + nodeHeight / 2 },
        })
      }
    }
    nodes.push({ node, x, y })
    return y
  }

  const rootYs = roots.map(place)
  const sessionY = rootYs.length > 0 ? rootYs[0] : rowY(0)
  nodes.push({ node: null, x: 0, y: sessionY })
  for (const y of rootYs) {
    edges.push({
      from: { x: nodeWidth, y: sessionY + nodeHeight / 2 },
      to: { x: columnX(1), y: y + nodeHeight / 2 },
    })
  }

  const maxX = Math.max(...nodes.map((n) => n.x)) + nodeWidth
  const maxY = Math.max(...nodes.map((n) => n.y)) + nodeHeight
  return { nodes, edges, width: maxX, height: maxY }
}
