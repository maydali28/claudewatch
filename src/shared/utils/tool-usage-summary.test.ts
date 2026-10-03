import { describe, expect, it } from 'vitest'
import type { SubagentSummary, ToolUsageRow } from '@shared/types/session'
import { summarizeAgentTypes, summarizeMcpServers, summarizeTools } from './tool-usage-summary'

const row = (over: Partial<ToolUsageRow>): ToolUsageRow => ({
  day: '2026-09-10',
  tool: 'Read',
  source: 'parent',
  calls: 1,
  errors: 0,
  resultChars: 10,
  costUsd: 0.1,
  ...over,
})

describe('summarizeTools', () => {
  it('merges days and sides, keeping the sub-agent share', () => {
    const out = summarizeTools([
      row({}),
      row({ day: '2026-09-11', source: 'subagent', calls: 2, errors: 1 }),
      row({ tool: 'Bash', calls: 5 }),
    ])
    expect(out.map((t) => t.tool)).toEqual(['Bash', 'Read'])
    expect(out[1]).toMatchObject({ calls: 3, subagentCalls: 2, errors: 1, resultChars: 20 })
  })
})

describe('summarizeMcpServers', () => {
  it('lists called servers and configured ones nobody called', () => {
    const out = summarizeMcpServers(
      [
        row({ tool: 'mcp__github__a', mcpServer: 'github', calls: 2 }),
        row({ tool: 'mcp__github__b', mcpServer: 'github', errors: 1 }),
        row({ tool: 'mcp__plugin_x__c', mcpServer: 'plugin_x' }),
      ],
      ['github', 'my.db']
    )
    expect(out).toEqual([
      {
        server: 'github',
        calls: 3,
        errors: 1,
        costUsd: expect.any(Number),
        toolsUsed: 2,
        configured: true,
      },
      {
        server: 'plugin_x',
        calls: 1,
        errors: 0,
        costUsd: expect.any(Number),
        toolsUsed: 1,
        configured: false,
      },
      { server: 'my_db', calls: 0, errors: 0, costUsd: 0, toolsUsed: 0, configured: true },
    ])
  })
})

describe('summarizeAgentTypes', () => {
  it('groups by type, costliest first', () => {
    const sub = (agentType: string | undefined, estimatedCost: number): SubagentSummary => ({
      agentId: Math.random().toString(),
      agentType,
      messageCount: 1,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstTimestamp: '',
      lastTimestamp: '',
      estimatedCost,
      modelBreakdown: [],
      durationMs: 1000,
    })
    expect(summarizeAgentTypes([sub('Explore', 1), sub(undefined, 3), sub('Explore', 1)])).toEqual([
      { agentType: 'unknown', runs: 1, costUsd: 3, durationMs: 1000 },
      { agentType: 'Explore', runs: 2, costUsd: 2, durationMs: 2000 },
    ])
  })
})
