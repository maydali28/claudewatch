import * as fs from 'fs'
import * as readline from 'readline'
import type {
  RawRecord,
  ParsedRecord,
  ParsedSession,
  ContentBlock,
  ToolResultEntry,
  TurnDuration,
  CompactionEvent,
  ParallelToolGroup,
  SessionErrorDetail,
  EffortDistribution,
} from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { MAX_TURN_DURATION_MS, ERROR_SNIPPET_MAX_CHARS } from '@shared/constants/tuning'
import {
  classifyEffort,
  classifyError,
  getRawBlocks,
  isSyntheticAssistant,
  isToolResultCarrierUser,
  parseTokenUsage,
} from './parser-helpers'
import { parseSubagents } from './subagent-parser'

/**
 * Parse a session JSONL file into a fully-hydrated `ParsedSession` —
 * including individual records, content blocks, and tool-result lookup map —
 * for the conversation viewer.
 *
 * Compared to `parseSessionMetadata`, this also retains every record so the
 * UI can render the transcript. Metadata accumulation runs in the same pass
 * to avoid streaming the file twice.
 */
export async function parseSessionFull(
  filePath: string,
  sessionId: string,
  projectId: string,
  pricingTable: Record<ModelFamily, ModelPricing> = {} as Record<ModelFamily, ModelPricing>
): Promise<ParsedSession> {
  const seenUuids = new Set<string>()
  const records: ParsedRecord[] = []
  const toolResultMap: Record<string, ToolResultEntry> = {}

  let slug: string | undefined
  let parentSessionId: string | undefined
  let isSubagent = false

  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined
  let messageCount = 0
  let userMessageCount = 0
  let assistantMessageCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheCreationTokens = 0
  const modelsSet = new Set<string>()
  let compactionCount = 0
  const turnDurations: TurnDuration[] = []
  const effortDist: EffortDistribution = { low: 0, medium: 0, high: 0, ultrathink: 0 }
  let maxIdleGapSeconds = 0
  let idleGapAfterTimestamp: string | undefined
  const compactionEvents: CompactionEvent[] = []
  const parallelToolGroups: ParallelToolGroup[] = []
  const errorDetails: SessionErrorDetail[] = []

  let lastMessageTimestamp: string | undefined
  let turnIndex = 0
  let lastTimestampMs: number | undefined
  let turnsSinceLastCompaction = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let raw: RawRecord
    try {
      raw = JSON.parse(trimmed) as RawRecord
    } catch {
      continue
    }

    if (raw.isCompactSummary === true) continue
    if (raw.type === 'progress') continue
    if (raw.isVisibleInTranscriptOnly === true) continue

    if (raw.uuid) {
      if (seenUuids.has(raw.uuid)) continue
      seenUuids.add(raw.uuid)
    }

    if (raw.slug && !slug) slug = raw.slug
    if (raw.parentUuid && !parentSessionId) parentSessionId = raw.parentUuid

    if (raw.timestamp) {
      if (!firstTimestamp) firstTimestamp = raw.timestamp
      lastTimestamp = raw.timestamp
      const ts = new Date(raw.timestamp).getTime()
      if (lastTimestampMs !== undefined) {
        const gapSec = (ts - lastTimestampMs) / 1000
        if (gapSec > maxIdleGapSeconds) {
          maxIdleGapSeconds = gapSec
          idleGapAfterTimestamp = raw.timestamp
        }
      }
      lastTimestampMs = ts
    }

    const isCompactionBoundary = raw.subtype === 'compact_boundary'
    if (isCompactionBoundary) {
      compactionCount++
      compactionEvents.push({
        index: compactionEvents.length,
        timestamp: raw.timestamp,
        preTokens: raw.compactMetadata?.preTokens,
        turnsSinceLastCompaction,
      })
      turnsSinceLastCompaction = 0
    }

    const rawBlocks = getRawBlocks(raw)

    // Single pass over rawBlocks: build contentBlocks, populate toolResultMap, and collect
    // per-record metrics needed for metadata accumulation. Avoids re-iterating the array.
    const contentBlocks: ContentBlock[] = []
    let assistantThinkingChars = 0
    let assistantErrorText = ''
    const assistantToolNames: string[] = []

    for (const block of rawBlocks) {
      if (block.type === 'text' && block.text !== undefined) {
        contentBlocks.push({ type: 'text', text: block.text })
        assistantErrorText += (assistantErrorText ? ' ' : '') + block.text
      } else if (block.type === 'thinking' && block.thinking !== undefined) {
        contentBlocks.push({ type: 'thinking', thinking: block.thinking })
        assistantThinkingChars += block.thinking.length
      } else if (block.type === 'tool_use' && block.id && block.name) {
        contentBlocks.push({
          type: 'tool_use',
          id: block.id,
          toolName: block.name,
          input: block.input ?? {},
        })
        assistantToolNames.push(block.name)
        if (block.name === 'EnterWorktree' || block.name === 'ExitWorktree') isSubagent = true
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        const rawContent = block.content
        let toolResultContent = ''
        if (typeof rawContent === 'string') {
          toolResultContent = rawContent
        } else if (Array.isArray(rawContent)) {
          toolResultContent = rawContent.map((chunk) => chunk.text ?? '').join('\n')
        }
        const toolResultIsError = block.is_error ?? false
        contentBlocks.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: toolResultContent,
          isError: toolResultIsError,
        })
        toolResultMap[block.tool_use_id] = {
          content: toolResultContent,
          isError: toolResultIsError,
        }
      }
    }

    const usage = parseTokenUsage(raw)

    const record: ParsedRecord = {
      type: raw.type ?? 'system',
      uuid: raw.uuid ?? crypto.randomUUID(),
      parentUuid: raw.parentUuid,
      timestamp: raw.timestamp,
      sessionId: raw.sessionId,
      cwd: raw.cwd,
      slug: raw.slug,
      role: raw.message?.role as 'user' | 'assistant' | 'system' | undefined,
      model: raw.message?.model,
      stopReason: raw.message?.stop_reason,
      usage: usage.inputTokens + usage.outputTokens > 0 ? usage : undefined,
      contentBlocks,
      isCompactionBoundary,
      compactionPreTokens: raw.compactMetadata?.preTokens,
    }

    const shouldExcludeFromRecords =
      (raw.type === 'user' && isToolResultCarrierUser(raw)) ||
      (raw.type === 'assistant' && isSyntheticAssistant(raw))

    if (!shouldExcludeFromRecords) {
      records.push(record)
    }

    // Metadata accumulation
    if (raw.type === 'user' && !isToolResultCarrierUser(raw)) {
      messageCount++
      userMessageCount++
      lastMessageTimestamp = raw.timestamp
      turnIndex++
      turnsSinceLastCompaction++
    } else if (raw.type === 'user' && raw.timestamp) {
      lastMessageTimestamp = raw.timestamp
    }

    if (raw.type === 'assistant' && !isSyntheticAssistant(raw)) {
      messageCount++
      assistantMessageCount++

      totalInputTokens += usage.inputTokens
      totalOutputTokens += usage.outputTokens
      totalCacheReadTokens += usage.cacheReadInputTokens
      totalCacheCreationTokens += usage.cacheCreationInputTokens

      const model = raw.message?.model
      if (model) modelsSet.add(model)

      const stopReason = raw.message?.stop_reason ?? undefined
      const effortLevel = classifyEffort(usage.outputTokens, assistantThinkingChars, stopReason)
      effortDist[effortLevel]++

      if (lastMessageTimestamp && raw.timestamp) {
        const turnDurationMs =
          new Date(raw.timestamp).getTime() - new Date(lastMessageTimestamp).getTime()
        if (turnDurationMs > 0 && turnDurationMs <= MAX_TURN_DURATION_MS) {
          turnDurations.push({
            turnIndex,
            prevTimestamp: lastMessageTimestamp,
            assistantTimestamp: raw.timestamp,
            durationMs: turnDurationMs,
            isPostCompaction: compactionEvents.length > 0 && turnsSinceLastCompaction <= 2,
            inputTokens: usage.inputTokens,
            model: model ?? undefined,
          })
        }
      }
      lastMessageTimestamp = raw.timestamp

      const errorClassification = classifyError(assistantErrorText, stopReason)
      if (errorClassification) {
        errorDetails.push({
          classification: errorClassification,
          turnIndex,
          timestamp: raw.timestamp,
          message: assistantErrorText.slice(0, ERROR_SNIPPET_MAX_CHARS),
        })
      }

      if (assistantToolNames.length > 1) {
        parallelToolGroups.push({
          turnIndex,
          timestamp: raw.timestamp,
          toolNames: assistantToolNames,
          toolCount: assistantToolNames.length,
        })
      }
    }
  }

  const subagents = await parseSubagents(filePath, pricingTable)

  let subagentInputTokens = 0
  let subagentOutputTokens = 0
  let subagentMessageCount = 0
  let subagentEstimatedCost = 0
  for (const sub of subagents) {
    subagentInputTokens += sub.totalInputTokens
    subagentOutputTokens += sub.totalOutputTokens
    subagentMessageCount += sub.messageCount
    subagentEstimatedCost += sub.estimatedCost
    for (const m of sub.modelBreakdown) {
      modelsSet.add(m.model)
    }
  }

  return {
    id: sessionId,
    projectId,
    slug,
    records,
    toolResultMap,
    metadata: {
      firstTimestamp: firstTimestamp ?? '',
      lastTimestamp: lastTimestamp ?? '',
      messageCount,
      userMessageCount,
      assistantMessageCount,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      models: Array.from(modelsSet),
      compactionCount,
      turnDurations,
      effortDistribution: effortDist,
      maxIdleGapSeconds,
      idleGapAfterTimestamp,
      compactionEvents,
      parallelToolGroups,
      errorDetails,
    },
    parentSessionId,
    isSubagent,
    subagentTotals: {
      inputTokens: subagentInputTokens,
      outputTokens: subagentOutputTokens,
      messageCount: subagentMessageCount,
      estimatedCost: subagentEstimatedCost,
    },
  }
}
