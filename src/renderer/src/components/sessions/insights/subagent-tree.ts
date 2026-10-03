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
