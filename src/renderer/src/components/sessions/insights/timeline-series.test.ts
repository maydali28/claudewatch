import { describe, expect, it } from 'vitest'
import { buildTimelineSeries } from './timeline-series'

describe('buildTimelineSeries', () => {
  it('accumulates priced cost, splits context by side and counts unpriced responses', () => {
    const s = buildTimelineSeries([
      {
        timestamp: '2026-09-10T10:00:00Z',
        source: 'parent',
        contextTokens: 100,
        outputTokens: 1,
        costUsd: 0.5,
      },
      {
        timestamp: '2026-09-10T10:01:00Z',
        source: 'subagent',
        agentId: 'a',
        contextTokens: 300,
        outputTokens: 1,
        costUsd: null,
      },
      { timestamp: 'garbage', source: 'parent', contextTokens: 999, outputTokens: 1, costUsd: 9 },
      {
        timestamp: '2026-09-10T10:02:00Z',
        source: 'parent',
        contextTokens: 200,
        outputTokens: 1,
        costUsd: 0.25,
      },
    ])
    expect(s.data.map((d) => d.cumulativeCost)).toEqual([0.5, 0.5, 0.75])
    expect(s.data[0].parentContext).toBe(100)
    expect(s.data[1]).toMatchObject({ subagentContext: 300, agentId: 'a' })
    expect(s.data[1].parentContext).toBeUndefined()
    expect(s).toMatchObject({
      peakContext: 300,
      totalCost: 0.75,
      unpricedResponses: 1,
      subagentResponses: 1,
    })
  })
})
