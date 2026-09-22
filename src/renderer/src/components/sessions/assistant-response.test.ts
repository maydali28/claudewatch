import { describe, expect, it } from 'vitest'
import type { ContentBlock, ParsedRecord } from '@shared/types'
import { groupResponses, isRenderableBlock } from './assistant-response'

describe('isRenderableBlock', () => {
  it('hides a thinking block whose text was redacted to nothing', () => {
    const block: ContentBlock = { type: 'thinking', thinking: '' }
    expect(isRenderableBlock(block)).toBe(false)
  })

  it('hides a thinking block that is only whitespace', () => {
    const block: ContentBlock = { type: 'thinking', thinking: '  \n' }
    expect(isRenderableBlock(block)).toBe(false)
  })

  it('shows a thinking block with text', () => {
    const block: ContentBlock = { type: 'thinking', thinking: 'Let me check the parser.' }
    expect(isRenderableBlock(block)).toBe(true)
  })

  it('shows text and tool_use blocks, never tool_result', () => {
    expect(isRenderableBlock({ type: 'text', text: 'hi' })).toBe(true)
    expect(isRenderableBlock({ type: 'tool_use', id: 't1', toolName: 'Read', input: {} })).toBe(
      true
    )
    expect(
      isRenderableBlock({ type: 'tool_result', toolUseId: 't1', content: 'x', isError: false })
    ).toBe(false)
  })
})

// ─── groupResponses ──────────────────────────────────────────────────────────

function assistant(
  uuid: string,
  responseId: string,
  blocks: ContentBlock[],
  extra: Partial<ParsedRecord> = {}
): ParsedRecord {
  return {
    type: 'assistant',
    uuid,
    role: 'assistant',
    model: 'claude-opus-5',
    responseId,
    contentBlocks: blocks,
    isCompactionBoundary: false,
    timestamp: '2026-09-22T10:00:00.000Z',
    usage: {
      inputTokens: 10,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    ...extra,
  }
}

function user(uuid: string, text: string): ParsedRecord {
  return {
    type: 'user',
    uuid,
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    isCompactionBoundary: false,
    timestamp: '2026-09-22T09:59:00.000Z',
  }
}

describe('groupResponses', () => {
  it('merges the records of one response into a single record, blocks in order', () => {
    const thinking: ContentBlock = { type: 'thinking', thinking: 'hm' }
    const text: ContentBlock = { type: 'text', text: 'Reading the file.' }
    const tool: ContentBlock = { type: 'tool_use', id: 't1', toolName: 'Read', input: {} }
    const grouped = groupResponses([
      assistant('a1', 'msg_1', [thinking]),
      assistant('a2', 'msg_1', [text]),
      assistant('a3', 'msg_1', [tool]),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].uuid).toBe('a1')
    expect(grouped[0].contentBlocks).toEqual([thinking, text, tool])
  })

  it('keeps distinct responses apart even when adjacent', () => {
    const grouped = groupResponses([
      assistant('a1', 'msg_1', [{ type: 'text', text: 'one' }]),
      assistant('a2', 'msg_2', [{ type: 'text', text: 'two' }]),
    ])
    expect(grouped.map((r) => r.uuid)).toEqual(['a1', 'a2'])
  })

  it('does not merge across a user record', () => {
    const grouped = groupResponses([
      assistant('a1', 'msg_1', [{ type: 'text', text: 'one' }]),
      user('u1', 'ok'),
      assistant('a2', 'msg_1', [{ type: 'text', text: 'two' }]),
    ])
    expect(grouped.map((r) => r.uuid)).toEqual(['a1', 'u1', 'a2'])
  })

  it('leaves records without a response id alone', () => {
    const grouped = groupResponses([
      assistant('a1', '', [{ type: 'text', text: 'one' }], { responseId: undefined }),
      assistant('a2', '', [{ type: 'text', text: 'two' }], { responseId: undefined }),
    ])
    expect(grouped.map((r) => r.uuid)).toEqual(['a1', 'a2'])
  })

  it('keeps the first record timestamp and the largest output token count', () => {
    const grouped = groupResponses([
      assistant('a1', 'msg_1', [{ type: 'thinking', thinking: '' }], {
        timestamp: '2026-09-22T10:00:00.000Z',
        usage: {
          inputTokens: 10,
          outputTokens: 40,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      }),
      assistant('a2', 'msg_1', [{ type: 'text', text: 'done' }], {
        timestamp: '2026-09-22T10:00:05.000Z',
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 120,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      }),
    ])
    expect(grouped[0].timestamp).toBe('2026-09-22T10:00:00.000Z')
    expect(grouped[0].usage?.outputTokens).toBe(120)
    expect(grouped[0].stopReason).toBe('end_turn')
  })

  it('does not mutate the input records', () => {
    const first = assistant('a1', 'msg_1', [{ type: 'text', text: 'one' }])
    groupResponses([first, assistant('a2', 'msg_1', [{ type: 'text', text: 'two' }])])
    expect(first.contentBlocks).toHaveLength(1)
  })
})
