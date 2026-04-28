import type {
  RawRecord,
  RawContentBlock,
  TokenUsage,
  EffortLevel,
  ErrorClassification,
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
