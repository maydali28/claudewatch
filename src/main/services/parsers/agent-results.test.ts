import { describe, expect, it } from 'vitest'
import type { RawRecord, SubagentSummary } from '@shared/types/session'
import { createAgentResultCollector } from './agent-results'

function sub(over: Partial<SubagentSummary>): SubagentSummary {
  return {
    agentId: 'a1',
    messageCount: 2,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    firstTimestamp: '2026-09-10T10:00:00.000Z',
    lastTimestamp: '2026-09-10T10:05:00.000Z',
    estimatedCost: 0,
    modelBreakdown: [],
    ...over,
  }
}

function toolResult(toolUseId: string, ts: string, extra?: RawRecord['toolUseResult']): RawRecord {
  return {
    type: 'user',
    uuid: `r-${toolUseId}-${ts}`,
    timestamp: ts,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'done' }] },
    toolUseResult: extra,
  }
}

function notification(agentId: string, ts: string, status: string, durationMs?: number): RawRecord {
  const usage =
    durationMs === undefined ? '' : `<usage><duration_ms>${durationMs}</duration_ms></usage>`
  return {
    type: 'user',
    uuid: `n-${agentId}-${ts}`,
    timestamp: ts,
    origin: { kind: 'task-notification' },
    message: {
      content: [
        {
          type: 'text',
          text: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>${status}</status>\n${usage}\n</task-notification>`,
        },
      ],
    },
  }
}

describe('createAgentResultCollector', () => {
  it("takes a foreground agent's duration and stop from its Agent tool result", () => {
    const c = createAgentResultCollector()
    c.add(
      toolResult('toolu_1', '2026-09-10T10:05:01.000Z', {
        agentId: 'a1',
        status: 'completed',
        totalDurationMs: 278243,
      })
    )
    const s = sub({ toolUseId: 'toolu_1' })
    c.apply([s])
    expect(s).toMatchObject({
      durationMs: 278243,
      durationSource: 'reported',
      stoppedAt: '2026-09-10T10:05:01.000Z',
    })
  })

  it('falls back to the timestamp span when nothing was reported', () => {
    const c = createAgentResultCollector()
    const s = sub({})
    c.apply([s])
    expect(s.durationMs).toBe(300_000)
    expect(s.durationSource).toBe('span')
    expect(s.stoppedAt).toBeUndefined()
  })

  it('marks a foreground agent stopped by a plain tool result (an error or interrupt)', () => {
    const c = createAgentResultCollector()
    c.add(toolResult('toolu_2', '2026-09-10T10:06:00.000Z'))
    const s = sub({ toolUseId: 'toolu_2' })
    c.apply([s])
    expect(s.stoppedAt).toBe('2026-09-10T10:06:00.000Z')
    expect(s.durationSource).toBe('span')
  })

  it("does not take a background agent's launch result as its end", () => {
    const c = createAgentResultCollector()
    c.add(
      toolResult('toolu_3', '2026-09-10T10:00:00.500Z', {
        agentId: 'a1',
        status: 'async_launched',
      })
    )
    const s = sub({ toolUseId: 'toolu_3', isBackground: true })
    c.apply([s])
    expect(s.stoppedAt).toBeUndefined()
  })

  it("reads a background agent's end from the latest task notification", () => {
    const c = createAgentResultCollector()
    c.add(notification('a1', '2026-09-10T10:05:00.000Z', 'completed', 187978))
    c.add(notification('a1', '2026-09-10T11:00:00.000Z', 'completed', 4000))
    // Out of order in the file: an older notification must not win.
    c.add(notification('a1', '2026-09-10T10:30:00.000Z', 'completed', 9000))
    c.add(notification('other', '2026-09-10T10:30:00.000Z', 'running'))
    const s = sub({ isBackground: true, toolUseId: 'toolu_4' })
    const other = sub({ agentId: 'other', isBackground: true })
    c.apply([s, other])
    expect(s).toMatchObject({
      durationMs: 4000,
      durationSource: 'reported',
      stoppedAt: '2026-09-10T11:00:00.000Z',
    })
    expect(other.stoppedAt).toBeUndefined()
  })

  it('reads a notification queued while the parent was mid-turn', () => {
    const c = createAgentResultCollector()
    c.add({
      type: 'attachment',
      uuid: 'q1',
      timestamp: '2026-09-10T10:05:00.000Z',
      attachment: {
        type: 'queued_command',
        commandMode: 'task-notification',
        prompt:
          '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>',
        usage: { totalTokens: 27927, toolUses: 2, durationMs: 21630 },
      },
    })
    // A queued slash command is not a notification.
    c.add({
      type: 'attachment',
      uuid: 'q2',
      timestamp: '2026-09-10T10:06:00.000Z',
      attachment: { type: 'queued_command', prompt: '/compact' },
    })
    const s = sub({ isBackground: true })
    c.apply([s])
    expect(s).toMatchObject({
      durationMs: 21630,
      durationSource: 'reported',
      stoppedAt: '2026-09-10T10:05:00.000Z',
    })
  })
})
