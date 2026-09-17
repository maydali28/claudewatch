import type {
  RawRecord,
  RawContentBlock,
  TokenUsage,
  EffortLevel,
  ErrorClassification,
  UserRecordKind,
} from '@shared/types/session'
import {
  EFFORT_LOW_MAX_TOKENS,
  EFFORT_MEDIUM_MAX_TOKENS,
  EFFORT_HIGH_MAX_TOKENS,
  EFFORT_MEDIUM_THINKING_CHARS,
  EFFORT_HIGH_THINKING_CHARS,
} from '@shared/constants/tuning'

/**
 * Classify how much effort an assistant turn used. Output token count is the
 * primary signal; thinking-block character count is a secondary signal that
 * captures `thinking` budget that did not produce visible output.
 */
export function classifyEffort(
  outputTokens: number,
  thinkingChars: number,
  stopReason?: string
): EffortLevel {
  if (
    thinkingChars > EFFORT_HIGH_THINKING_CHARS ||
    outputTokens > EFFORT_HIGH_MAX_TOKENS ||
    stopReason === 'max_tokens'
  ) {
    return 'ultrathink'
  }
  if (thinkingChars > EFFORT_MEDIUM_THINKING_CHARS || outputTokens > EFFORT_MEDIUM_MAX_TOKENS) {
    return 'high'
  }
  if (thinkingChars > 0 || outputTokens > EFFORT_LOW_MAX_TOKENS) {
    return 'medium'
  }
  return 'low'
}

/**
 * Map an assistant error message (or stop reason) onto a coarse error
 * classification used by the lint and observability surfaces.
 */
export function classifyError(text: string, stopReason?: string): ErrorClassification | null {
  const lower = text.toLowerCase()
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    return 'rateLimit'
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'authFailure'
  }
  if (
    lower.includes('proxy') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('gateway')
  ) {
    return 'proxyError'
  }
  if (stopReason === 'max_tokens') {
    return 'maxTokensTruncation'
  }
  return null
}

export function extractTextFromContent(blocks: RawContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join(' ')
}

export function parseTokenUsage(raw: RawRecord): TokenUsage {
  const u = raw.message?.usage
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
    cacheCreation: u?.cache_creation
      ? {
          ephemeral5mInputTokens: u.cache_creation.ephemeral_5m_input_tokens ?? 0,
          ephemeral1hInputTokens: u.cache_creation.ephemeral_1h_input_tokens ?? 0,
        }
      : undefined,
  }
}

export function getRawBlocks(raw: RawRecord): RawContentBlock[] {
  const content = raw.message?.content
  if (!content) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

export function isSyntheticAssistant(raw: RawRecord): boolean {
  return raw.message?.model === '<synthetic>'
}

export function isToolResultCarrierUser(raw: RawRecord): boolean {
  const content = raw.message?.content
  if (!Array.isArray(content) || content.length === 0) return false
  return content.every((b) => b.type === 'tool_result')
}

export type { UserRecordKind }

/**
 * Text a local slash command, its output or its caveat starts with. Claude
 * never answers these; shared with `metadata-parser.ts`'s turn state so the
 * counting and live-turn rules read the same prefixes.
 */
export const LOCAL_COMMAND_PREFIXES = [
  '<command-name>',
  '<local-command-stdout>',
  '<local-command-caveat>',
] as const
/** Text the Esc interrupt marker starts with. */
export const INTERRUPT_PREFIX = '[Request interrupted by user'
const TASK_NOTIFICATION_PREFIX = '<task-notification>'
const AGENT_MESSAGE_PREFIX = 'Another Claude session sent a message'
const AGENT_MESSAGE_TAG = '<agent-message'

/**
 * What a `type: 'user'` record is — the one place that decides whether a
 * person wrote it. Claude Code writes several kinds of record under
 * `type: 'user'`; only `'prompt'` counts as a user message or is drawn as the
 * user's bubble.
 *
 * `origin` is written by recent Claude Code versions only, and not on every
 * record even then, so records without one fall back to their text. An
 * origin kind this code does not know is machine-written by definition (a
 * person's prompt is always `human`), so it is `'meta'`, never a prompt.
 *
 * Local-command prefixes are checked before `isMeta`: the caveat that
 * precedes a local command's output is written with `isMeta: true`, and it
 * belongs with the command it describes.
 */
export function classifyUserRecord(raw: RawRecord): UserRecordKind {
  if (isToolResultCarrierUser(raw)) return 'tool-result'
  if (raw.isCompactSummary === true) return 'compact-summary'

  const originKind = raw.origin?.kind
  if (originKind === 'task-notification') return 'task-notification'
  if (originKind === 'peer') return 'agent-message'
  if (originKind === 'human') return 'prompt'
  if (raw.origin) return 'meta'

  const text = getRawBlocks(raw)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trimStart()
  if (text.startsWith(TASK_NOTIFICATION_PREFIX)) return 'task-notification'
  // Prefix only: a prompt may quote the tag or the harness line mid-text
  // (a real sub-agent opening prompt did), and it is still a prompt.
  if (text.startsWith(AGENT_MESSAGE_PREFIX) || text.startsWith(AGENT_MESSAGE_TAG)) {
    return 'agent-message'
  }
  if (LOCAL_COMMAND_PREFIXES.some((prefix) => text.startsWith(prefix))) return 'local-command'
  if (raw.isMeta === true) return 'meta'
  if (text.startsWith(INTERRUPT_PREFIX)) return 'interrupt'
  return 'prompt'
}
