import { describe, expect, it } from 'vitest'
import type { RawRecord, ToolUsageRow } from '@shared/types/session'
import type { ResponseEntry } from '@main/services/accounting/ledger'
import { createToolUsageAccumulator, mergeToolUsage } from './tool-usage'

function toolUse(msgId: string, uuid: string, id: string, name: string): RawRecord {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: msgId,
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id, name, input: {} }],
    },
  }
}

function result(id: string, content: unknown, isError = false): RawRecord {
  return {
    type: 'user',
    uuid: `r-${id}`,
    timestamp: '2026-09-10T10:00:01.000Z',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, content: content as string, is_error: isError },
      ],
    },
  }
}

const entry = (responseId: string, costUsd: number | null): ResponseEntry =>
  ({ responseId, dayLocal: '2026-09-10', costUsd }) as unknown as ResponseEntry

describe('createToolUsageAccumulator', () => {
  it('counts calls once, joins results and splits a response cost across its calls', () => {
    const acc = createToolUsageAccumulator('parent')
    acc.add(toolUse('m1', 'u1', 't1', 'Read'))
    acc.add(toolUse('m1', 'u2', 't2', 'mcp__github__get_me'))
    acc.add(toolUse('m1', 'u2-replay', 't2', 'mcp__github__get_me'))
    acc.add(toolUse('m2', 'u3', 't3', 'Read'))
    acc.add(result('t1', 'abcd'))
    acc.add(result('t2', [{ type: 'text', text: 'xy' }], true))
    // t3 has no result yet; m2 is unpriced.

    const rows = acc.rows([entry('m1', 1), entry('m2', null)])
    const read = rows.find((r) => r.tool === 'Read')!
    const gh = rows.find((r) => r.tool === 'mcp__github__get_me')!
    expect(read).toMatchObject({
      calls: 2,
      errors: 0,
      resultChars: 4,
      costUsd: 0.5,
      source: 'parent',
    })
    expect(read.mcpServer).toBeUndefined()
    expect(gh).toMatchObject({
      calls: 1,
      errors: 1,
      resultChars: 2,
      costUsd: 0.5,
      mcpServer: 'github',
    })
  })

  it('dates a call by its response, or its own timestamp without one', () => {
    const acc = createToolUsageAccumulator('subagent')
    acc.add(toolUse('m9', 'u9', 't9', 'Bash'))
    expect(acc.rows([])[0]).toMatchObject({ day: '2026-09-10', costUsd: 0, source: 'subagent' })
  })
})

describe('mergeToolUsage', () => {
  it('sums rows with the same day, tool and source and keeps the rest apart', () => {
    const row = (over: Partial<ToolUsageRow>): ToolUsageRow => ({
      day: 'd',
      tool: 'Read',
      source: 'parent',
      calls: 1,
      errors: 0,
      resultChars: 1,
      costUsd: 1,
      ...over,
    })
    const into = [row({})]
    mergeToolUsage(into, [row({}), row({ source: 'subagent' })])
    expect(into).toHaveLength(2)
    expect(into[0]).toMatchObject({ calls: 2, resultChars: 2, costUsd: 2 })
  })
})
