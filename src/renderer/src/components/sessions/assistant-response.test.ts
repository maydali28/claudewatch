import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@shared/types'
import { isRenderableBlock } from './assistant-response'

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
