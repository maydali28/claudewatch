import { describe, expect, it } from 'vitest'
import type { ResponseEntry } from './ledger'
import { projectUsage } from './projection'

let seq = 0

function entry(over: Partial<ResponseEntry> = {}): ResponseEntry {
  seq++
  return {
    responseId: `msg_${seq}`,
    filePath: '/p/sess.jsonl',
    kind: 'parent',
    projectId: 'proj',
    sessionId: 'sess',
    tsUtc: '2026-09-10T10:00:00.000Z',
    dayLocal: '2026-09-10',
    modelRaw: 'claude-opus-5',
    modelFamily: 'opus-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheWriteFlat: 0,
    snapshotCount: 1,
    usageConflict: false,
    costUsd: 0,
    pricingRevision: 2,
    ...over,
  }
}

/**
 * The parent summary previously rolled up subagent input, output, cost and
 * cache writes but silently omitted subagent cache reads, so a session's totals
 * could not reconcile with its own model breakdown. On one real session the gap
 * was exactly 101,950,511 tokens.
 */
describe('projectUsage — parent and child scopes', () => {
  it('rolls up every category from subagents, cache reads included', () => {
    const p = projectUsage([
      entry({ kind: 'parent', inputTokens: 10, cacheReadTokens: 100 }),
      entry({ kind: 'subagent', agentId: 'a1', inputTokens: 5, cacheReadTokens: 500 }),
    ])

    expect(p.parent.cacheReadTokens).toBe(100)
    expect(p.combined.cacheReadTokens).toBe(600)
    expect(p.combined.inputTokens).toBe(15)
  })

  it('reconciles combined totals with the model breakdown', () => {
    const p = projectUsage([
      entry({ kind: 'parent', modelRaw: 'claude-opus-5', cacheReadTokens: 100 }),
      entry({
        kind: 'subagent',
        modelRaw: 'claude-haiku-4-5',
        modelFamily: 'haiku-4-5',
        cacheReadTokens: 500,
      }),
    ])

    const fromBreakdown = p.modelBreakdown.reduce((s, m) => s + m.cacheReadTokens, 0)
    expect(fromBreakdown).toBe(p.combined.cacheReadTokens)
  })

  it('keeps parent-only totals free of subagent usage', () => {
    const p = projectUsage([
      entry({ kind: 'parent', outputTokens: 7 }),
      entry({ kind: 'subagent', outputTokens: 900 }),
    ])

    expect(p.parent.outputTokens).toBe(7)
    expect(p.combined.outputTokens).toBe(907)
  })
})

/**
 * The badge showed whichever model had accumulated the most turns, so switching
 * model mid-session kept displaying the old one. Latest and dominant are now
 * distinct, and a subagent never determines the parent's badge.
 */
describe('projectUsage — model identity', () => {
  it('reports the latest parent model by response time', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T09:30:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T10:00:00.000Z', modelRaw: 'claude-sonnet-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-sonnet-5')
  })

  it('reports the dominant parent model by response count', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T09:30:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T10:00:00.000Z', modelRaw: 'claude-sonnet-5' }),
    ])

    expect(p.dominantParentModel).toBe('claude-opus-5')
  })

  it('does not let a subagent model become the parent badge', () => {
    const p = projectUsage([
      entry({ kind: 'parent', tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ kind: 'subagent', tsUtc: '2026-09-10T23:00:00.000Z', modelRaw: 'claude-haiku-4-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-opus-5')
  })

  it('lists every model used, parent and child', () => {
    const p = projectUsage([
      entry({ kind: 'parent', modelRaw: 'claude-opus-5' }),
      entry({ kind: 'subagent', modelRaw: 'claude-haiku-4-5' }),
    ])

    expect([...p.modelsUsed].sort()).toEqual(['claude-haiku-4-5', 'claude-opus-5'])
  })
})

/**
 * Analytics attributed a session's entire history to its last active day, so
 * resuming yesterday's session today moved yesterday's tokens into today.
 */
describe('projectUsage — day attribution', () => {
  it('buckets each response on its own day', () => {
    const p = projectUsage([
      entry({ dayLocal: '2026-09-08', inputTokens: 100, outputTokens: 10 }),
      entry({ dayLocal: '2026-09-08', inputTokens: 200, outputTokens: 20 }),
      entry({ dayLocal: '2026-09-09', inputTokens: 30, outputTokens: 3 }),
    ])

    expect(p.byDay.map((d) => d.day)).toEqual(['2026-09-08', '2026-09-09'])
    expect(p.byDay[0].inputTokens + p.byDay[0].outputTokens).toBe(330)
    expect(p.byDay[1].inputTokens + p.byDay[1].outputTokens).toBe(33)
  })

  it('attributes a subagent to its own day, not the parent’s', () => {
    const p = projectUsage([
      entry({ kind: 'parent', dayLocal: '2026-09-08', outputTokens: 1 }),
      entry({ kind: 'subagent', dayLocal: '2026-09-09', outputTokens: 5 }),
    ])

    expect(p.byDay.map((d) => d.day)).toEqual(['2026-09-08', '2026-09-09'])
  })

  it('records which models were used on each day', () => {
    const p = projectUsage([
      entry({ dayLocal: '2026-09-08', modelRaw: 'claude-opus-5', modelFamily: 'opus-5' }),
      entry({ dayLocal: '2026-09-09', modelRaw: 'claude-sonnet-5', modelFamily: 'sonnet-5' }),
    ])

    expect(p.byDay[0].families).toEqual(['opus-5'])
    expect(p.byDay[1].families).toEqual(['sonnet-5'])
  })
})

/**
 * An unrecognised model must keep its tokens visible while staying out of a
 * cost total that is presented as complete.
 */
describe('projectUsage — unpriced responses', () => {
  it('counts unpriced tokens but excludes them from cost', () => {
    const p = projectUsage([
      entry({ modelFamily: 'opus-5', outputTokens: 100, costUsd: 2.5 }),
      entry({
        modelRaw: 'claude-future-9',
        modelFamily: 'unknown',
        outputTokens: 40,
        costUsd: null,
      }),
    ])

    expect(p.combined.outputTokens).toBe(140)
    expect(p.combined.estimatedCost).toBeCloseTo(2.5, 10)
    expect(p.combined.unpricedResponses).toBe(1)
  })

  it('keeps unrecognised models visible in the breakdown', () => {
    const p = projectUsage([
      entry({
        modelRaw: 'claude-future-9',
        modelFamily: 'unknown',
        outputTokens: 40,
        costUsd: null,
      }),
    ])

    expect(p.modelBreakdown.map((m) => m.model)).toEqual(['claude-future-9'])
    expect(p.modelBreakdown[0].estimatedCost).toBeNull()
  })
})

describe('projectUsage — empty input', () => {
  it('produces zeroed totals rather than throwing', () => {
    const p = projectUsage([])

    expect(p.combined.responseCount).toBe(0)
    expect(p.combined.estimatedCost).toBe(0)
    expect(p.latestParentModel).toBeUndefined()
    expect(p.byDay).toEqual([])
  })
})
