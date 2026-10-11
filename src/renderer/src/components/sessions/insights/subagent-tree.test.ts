import { describe, expect, it } from 'vitest'
import type { SubagentSummary } from '@shared/types'
import { buildSubagentTree, layoutSubagentGraph } from './subagent-tree'

function sub(
  agentId: string,
  minute: number,
  cost: number,
  parentAgentId?: string
): SubagentSummary {
  return {
    agentId,
    parentAgentId,
    messageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    firstTimestamp: `2026-09-10T10:${String(minute).padStart(2, '0')}:00.000Z`,
    lastTimestamp: `2026-09-10T10:${String(minute).padStart(2, '0')}:30.000Z`,
    estimatedCost: cost,
    modelBreakdown: [],
  }
}

describe('buildSubagentTree', () => {
  it('nests agents under their parent, oldest first, with subtree and level totals', () => {
    const tree = buildSubagentTree([
      sub('b', 5, 1),
      sub('a', 1, 2),
      sub('a2', 4, 0.5, 'a'),
      sub('a1', 2, 0.25, 'a'),
      sub('a1x', 3, 0.125, 'a1'),
    ])
    expect(tree.roots.map((n) => n.sub.agentId)).toEqual(['a', 'b'])
    const a = tree.roots[0]
    expect(a.children.map((n) => n.sub.agentId)).toEqual(['a1', 'a2'])
    expect(a.children[0].children[0]).toMatchObject({ depth: 3, subtreeRuns: 1 })
    expect(a).toMatchObject({ depth: 1, subtreeRuns: 4, subtreeCost: 2.875, orphan: false })
    expect(tree.levels).toEqual([
      { depth: 1, runs: 2, cost: 3 },
      { depth: 2, runs: 2, cost: 0.75 },
      { depth: 3, runs: 1, cost: 0.125 },
    ])
  })

  it('shows an agent whose parent transcript is gone at the top, marked', () => {
    const tree = buildSubagentTree([sub('x', 1, 1, 'missing')])
    expect(tree.roots[0]).toMatchObject({ depth: 1, orphan: true })
  })

  it('breaks a parent cycle instead of looping', () => {
    const tree = buildSubagentTree([sub('p', 1, 1, 'q'), sub('q', 2, 1, 'p')])
    expect(tree.roots.reduce((s, n) => s + n.subtreeRuns, 0)).toBe(2)
  })
})

describe('layoutSubagentGraph', () => {
  const size = { nodeWidth: 100, nodeHeight: 20, columnGap: 40, rowGap: 10 }

  it('puts depths in columns and each parent level with its first child', () => {
    const tree = buildSubagentTree([
      sub('a', 1, 1),
      sub('a1', 2, 1, 'a'),
      sub('a2', 3, 1, 'a'),
      sub('b', 4, 1),
    ])
    const g = layoutSubagentGraph(tree.roots, new Set(), size)
    const at = (id: string | null) =>
      g.nodes.find((n) => (n.node ? n.node.sub.agentId : null) === id)!
    // Leaves take rows 0, 1, 2 (30px apart); a sits level with a1.
    expect(at('a1')).toMatchObject({ x: 280, y: 0 })
    expect(at('a2')).toMatchObject({ x: 280, y: 30 })
    expect(at('a')).toMatchObject({ x: 140, y: 0 })
    expect(at('b')).toMatchObject({ x: 140, y: 60 })
    // The session sits level with its first child, a.
    expect(at(null)).toMatchObject({ x: 0, y: 0 })
    expect(g.edges).toHaveLength(4)
    expect(g).toMatchObject({ width: 380, height: 80 })
  })

  it('lays a collapsed parent out as a leaf and drops its branch', () => {
    const tree = buildSubagentTree([sub('a', 1, 1), sub('a1', 2, 1, 'a')])
    const g = layoutSubagentGraph(tree.roots, new Set(['a']), size)
    expect(g.nodes.map((n) => n.node?.sub.agentId ?? 'session').sort()).toEqual(['a', 'session'])
    expect(g.edges).toHaveLength(1)
  })

  it('still places the session with no sub-agents', () => {
    const g = layoutSubagentGraph([], new Set(), size)
    expect(g.nodes).toEqual([{ node: null, x: 0, y: 0 }])
    expect(g.edges).toEqual([])
  })
})
