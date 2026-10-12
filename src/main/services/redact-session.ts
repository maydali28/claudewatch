import type { AnyCodableValue, ContentBlock, ParsedSession } from '@shared/types/session'
import { redactText, type RedactionLevel } from '@shared/utils/secret-patterns'

function redactValue(value: AnyCodableValue, level: RedactionLevel): AnyCodableValue {
  if (typeof value === 'string') return redactText(value, level)
  if (Array.isArray(value)) return value.map((v) => redactValue(v, level))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, level)]))
  }
  return value
}

function redactBlock(block: ContentBlock, level: RedactionLevel): ContentBlock {
  switch (block.type) {
    case 'text':
      return { ...block, text: redactText(block.text, level) }
    case 'thinking':
      return { ...block, thinking: redactText(block.thinking, level) }
    case 'tool_use':
      return {
        ...block,
        input: redactValue(block.input, level) as Record<string, AnyCodableValue>,
      }
    case 'tool_result':
      return { ...block, content: redactText(block.content, level) }
  }
}

/**
 * A copy of `session` with every secret in its text, thinking, tool inputs and
 * tool results masked or removed, per the user's redaction setting. Applied on
 * the way out to the window and to exports; the parse cache keeps the raw
 * session, so changing the setting needs no re-parse. Usage and cost are
 * untouched.
 */
export function redactParsedSession(session: ParsedSession, level: RedactionLevel): ParsedSession {
  if (level === 'none') return session
  return {
    ...session,
    records: session.records.map((r) => ({
      ...r,
      contentBlocks: r.contentBlocks.map((b) => redactBlock(b, level)),
    })),
    toolResultMap: Object.fromEntries(
      Object.entries(session.toolResultMap).map(([id, r]) => [
        id,
        { ...r, content: redactText(r.content, level) },
      ])
    ),
  }
}
