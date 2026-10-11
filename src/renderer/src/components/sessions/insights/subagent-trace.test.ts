import { describe, expect, it } from 'vitest'
import type { SubagentSummary } from '@shared/types'
import { buildSubagentTree } from './subagent-tree'
import { buildTrace, IDLE_GAP_MS, tracePosition, traceTicks } from './subagent-trace'

const T0 = Date.parse('2026-09-10T10:00:00.000Z')
const at = (sec: number): string => new Date(T0 + sec * 1000).toISOString()

function sub(
  agentId: string,
  startSec: number,
  lastSec: number,
  over: Partial<SubagentSummary> = {}
): SubagentSummary {
  return {
    agentId,
    messageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    firstTimestamp: at(startSec),
    lastTimestamp: at(lastSec),
    estimatedCost: 0,
    modelBreakdown: [],
    stoppedAt: at(lastSec + 1),
    toolUseId: 't',
    ...over,
  }
}

describe('buildTrace', () => {
  const later = T0 + 24 * 3600 * 1000

  it('flattens the tree in order and takes the reported run time over the span', () => {
    const tree = buildSubagentTree([
      sub('a', 0, 100, { durationMs: 60_000, durationSource: 'reported' }),
      sub('a1', 10, 40, { parentAgentId: 'a' }),
      sub('b', 50, 70),
    ])
    const trace = buildTrace(tree.roots, new Set(), later)
    expect(trace.rows.map((r) => r.node.sub.agentId)).toEqual(['a', 'a1', 'b'])
    expect(trace.rows[0]).toMatchObject({ start: T0, end: T0 + 60_000, endSource: 'reported' })
    expect(trace.rows[1]).toMatchObject({ end: T0 + 40_000, endSource: 'span' })
    expect(trace).toMatchObject({ start: T0, end: T0 + 70_000 })
  })

  it('skips a collapsed branch', () => {
    const tree = buildSubagentTree([sub('a', 0, 10), sub('a1', 1, 5, { parentAgentId: 'a' })])
    expect(buildTrace(tree.roots, new Set(['a']), later).rows).toHaveLength(1)
  })

  it('draws a running agent up to now', () => {
    const now = T0 + 30_000
    const tree = buildSubagentTree([sub('r', 0, 20, { stoppedAt: undefined })])
    expect(buildTrace(tree.roots, new Set(), now).rows[0]).toMatchObject({
      end: now,
      endSource: 'running',
    })
  })

  it('leaves out an agent with no start time', () => {
    const tree = buildSubagentTree([sub('x', 0, 1, { firstTimestamp: '' })])
    expect(buildTrace(tree.roots, new Set(), later)).toMatchObject({ rows: [], ticks: [] })
  })
})

describe('traceTicks', () => {
  it('picks a round step giving about six ticks', () => {
    const ticks = traceTicks(T0, T0 + 10 * 60_000)
    expect(ticks.map((t) => (t.at - T0) / 60_000)).toEqual([0, 2, 4, 6, 8, 10])
    expect(ticks[5].position).toBe(1)
  })

  it('returns none for an empty span', () => {
    expect(traceTicks(T0, T0)).toEqual([])
  })
})

describe('idle gaps', () => {
  const later = T0 + 48 * 3600 * 1000

  it('cuts a long idle stretch out of the axis and keeps runs in order', () => {
    const tree = buildSubagentTree([
      sub('a', 0, 600), // 10 min
      sub('b', 6 * 3600, 6 * 3600 + 600), // 6 h later, 10 min
    ])
    const trace = buildTrace(tree.roots, new Set(), later)
    expect(trace.gaps).toHaveLength(1)
    expect(trace.gaps[0]).toMatchObject({ start: T0 + 600_000, end: T0 + 6 * 3600_000 })
    expect(trace.segments).toHaveLength(2)
    // Two equal busy stretches share what the break leaves.
    const [a, b] = trace.rows
    expect(tracePosition(trace, a.start)).toBe(0)
    expect(tracePosition(trace, a.end)).toBeCloseTo(trace.gaps[0].from)
    expect(tracePosition(trace, b.start)).toBeCloseTo(trace.gaps[0].to)
    expect(tracePosition(trace, b.end)).toBe(1)
    expect(trace.ticks.every((t) => t.position >= 0 && t.position <= 1)).toBe(true)
  })

  it('keeps a short pause on the axis', () => {
    const tree = buildSubagentTree([sub('a', 0, 60), sub('b', 60 + IDLE_GAP_MS / 1000 - 5, 900)])
    const trace = buildTrace(tree.roots, new Set(), later)
    expect(trace.gaps).toEqual([])
    expect(trace.segments).toHaveLength(1)
  })
})
