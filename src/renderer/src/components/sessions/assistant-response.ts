import type { ContentBlock, ParsedRecord } from '@shared/types'

/**
 * One transcript entry per API response.
 *
 * Claude Code writes a response as one record per content block — thinking,
 * text, each tool_use — sharing a `responseId` and repeating the response's
 * usage. The header already counts responses (see `activity-reducer.ts`);
 * this makes the transcript agree with it, so a response is one bubble with
 * one model/effort header instead of two or three that look like repeats.
 *
 * Only adjacent records merge. Anything else — a prompt, a compaction
 * boundary — ends the group, so the order the reader sees is the order on
 * disk. The merged record keeps the first record's identity (`uuid`,
 * `timestamp`), which is what `turnDurations` is keyed on; `outputTokens` is
 * the largest seen, and `stopReason` comes from the last record that carried
 * one, both as the parser's own response merging does.
 */
export function groupResponses(records: ParsedRecord[]): ParsedRecord[] {
  const out: ParsedRecord[] = []
  for (const record of records) {
    const last = out[out.length - 1]
    if (
      last &&
      record.responseId !== undefined &&
      last.responseId === record.responseId &&
      last.role === 'assistant' &&
      record.role === 'assistant'
    ) {
      out[out.length - 1] = mergeInto(last, record)
      continue
    }
    out.push(record)
  }
  return out
}

function mergeInto(head: ParsedRecord, next: ParsedRecord): ParsedRecord {
  const usage =
    head.usage && next.usage && next.usage.outputTokens > head.usage.outputTokens
      ? { ...head.usage, outputTokens: next.usage.outputTokens }
      : (head.usage ?? next.usage)
  return {
    ...head,
    contentBlocks: [...head.contentBlocks, ...next.contentBlocks],
    usage,
    stopReason: next.stopReason ?? head.stopReason,
  }
}

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
