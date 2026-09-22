import type { ContentBlock } from '@shared/types'

/**
 * Whether the transcript has anything to draw for this block.
 *
 * Claude Code redacts thinking in the transcript: the block is kept, with its
 * signature, but `thinking` is written as an empty string. Measured history:
 * 6,477 of 6,990 thinking blocks are empty. They still count for effort (zero
 * chars), so this is a rendering rule only. Tool results are drawn inside the
 * tool_use block they answer, never on their own.
 */
export function isRenderableBlock(block: ContentBlock): boolean {
  switch (block.type) {
    case 'thinking':
      return block.thinking.trim().length > 0
    case 'text':
    case 'tool_use':
      return true
    case 'tool_result':
      return false
  }
}
