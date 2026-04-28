import * as fs from 'fs'
import * as readline from 'readline'
import type {
  RawRecord,
  RawContentBlock,
  SessionSummary,
  TokenUsage,
  EffortLevel,
  TurnDuration,
  CompactionEvent,
  ParallelToolGroup,
  SessionErrorDetail,
  ModelTokenBreakdown,
  SessionObservability,
  EffortDistribution,
} from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { getModelFamily } from '@shared/constants/models'
import { estimateCost } from '@shared/constants/pricing'
import { decodeProjectId } from '@shared/utils/decode-project-id'
import {
  IDLE_GAP_MS,
  MAX_TURN_DURATION_MS,
  ERROR_SNIPPET_MAX_CHARS,
} from '@shared/constants/tuning'
import {
  classifyEffort,
  classifyError,
  extractTextFromContent,
  getRawBlocks,
  isSyntheticAssistant,
  isToolResultCarrierUser,
  parseTokenUsage,
} from './parser-helpers'
import { parseSubagents } from './subagent-parser'

interface MetadataAccumulator {
  // Identity
  slug: string | undefined
  title: string
  cwd: string | undefined

  // Timestamps
  firstTimestamp: string | undefined
  lastTimestamp: string | undefined
  lastTimestampForGap: number | undefined

  // Counters
  messageCount: number
  toolCallCount: number
  compactionCount: number

  // Observability
  turnDurations: TurnDuration[]
  effortDist: EffortDistribution
  compactionEvents: CompactionEvent[]
  parallelToolGroups: ParallelToolGroup[]
  errorDetails: SessionErrorDetail[]
  hasError: boolean
  hasIdleZombieGap: boolean
  estimatedIdleWasteCost: number
  isWorktreeSession: boolean
  parallelToolCallCount: number
  maxParallelDegree: number

  // Turn tracking
  lastMessageTimestamp: string | undefined
  turnIndex: number
  turnsSinceLastCompaction: number

  // Per-model breakdown
  modelBreakdownMap: Map<string, ModelTokenBreakdown>
}

function createMetadataAccumulator(sessionId: string): MetadataAccumulator {
  return {
    slug: undefined,
    title: sessionId,
    cwd: undefined,
    firstTimestamp: undefined,
    lastTimestamp: undefined,
    lastTimestampForGap: undefined,
    messageCount: 0,
    toolCallCount: 0,
    compactionCount: 0,
    turnDurations: [],
    effortDist: { low: 0, medium: 0, high: 0, ultrathink: 0 },
    compactionEvents: [],
    parallelToolGroups: [],
    errorDetails: [],
    hasError: false,
    hasIdleZombieGap: false,
    estimatedIdleWasteCost: 0,
    isWorktreeSession: false,
    parallelToolCallCount: 0,
    maxParallelDegree: 0,
    lastMessageTimestamp: undefined,
    turnIndex: 0,
    turnsSinceLastCompaction: 0,
    modelBreakdownMap: new Map(),
  }
}

function shouldSkipRecord(raw: RawRecord, seenUuids: Set<string>): boolean {
  if (raw.isCompactSummary === true) return true
  if (raw.type === 'progress') return true
  if (raw.isVisibleInTranscriptOnly === true) return true
  if (raw.uuid) {
    if (seenUuids.has(raw.uuid)) return true
    seenUuids.add(raw.uuid)
  }
  return false
}

function processTimestamps(raw: RawRecord, acc: MetadataAccumulator): void {
  if (!raw.timestamp) return

  if (!acc.firstTimestamp) acc.firstTimestamp = raw.timestamp
  acc.lastTimestamp = raw.timestamp

  const ts = new Date(raw.timestamp).getTime()
  if (acc.lastTimestampForGap !== undefined && ts - acc.lastTimestampForGap > IDLE_GAP_MS) {
    acc.hasIdleZombieGap = true
  }
  acc.lastTimestampForGap = ts
}

function processCompactionBoundary(raw: RawRecord, acc: MetadataAccumulator): void {
  acc.compactionCount++
  acc.compactionEvents.push({
    index: acc.compactionEvents.length,
    timestamp: raw.timestamp,
    preTokens: raw.compactMetadata?.preTokens,
    turnsSinceLastCompaction: acc.turnsSinceLastCompaction,
  })
  acc.turnsSinceLastCompaction = 0
}

function processUserRecord(_raw: RawRecord, acc: MetadataAccumulator): void {
  acc.messageCount++
  acc.lastMessageTimestamp = _raw.timestamp
  acc.turnIndex++
  acc.turnsSinceLastCompaction++
}

function accumulateModelBreakdown(
  model: string,
  usage: TokenUsage,
  cache5m: number,
  cache1h: number,
  cost: number,
  acc: MetadataAccumulator
): void {
  const existing = acc.modelBreakdownMap.get(model)
  if (existing) {
    existing.inputTokens += usage.inputTokens
    existing.outputTokens += usage.outputTokens
    existing.cacheReadTokens += usage.cacheReadInputTokens
    existing.cacheCreation5mTokens += cache5m
    existing.cacheCreation1hTokens += cache1h
    existing.estimatedCost += cost
    existing.turnCount++
  } else {
    acc.modelBreakdownMap.set(model, {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadInputTokens,
      cacheCreation5mTokens: cache5m,
      cacheCreation1hTokens: cache1h,
      estimatedCost: cost,
      turnCount: 1,
    })
  }
}

function accumulateBlockMetrics(
  blocks: RawContentBlock[],
  raw: RawRecord,
  usage: TokenUsage,
  acc: MetadataAccumulator
): void {
  let thinkingChars = 0
  const parallelToolNames: string[] = []
  let hasToolError = false

  for (const block of blocks) {
    if (block.type === 'thinking') {
      thinkingChars += block.thinking?.length ?? 0
    }
    if (block.type === 'tool_use') {
      acc.toolCallCount++
      parallelToolNames.push(block.name ?? '')
      if (block.name === 'EnterWorktree' || block.name === 'ExitWorktree') {
        acc.isWorktreeSession = true
      }
    }
    if (block.type === 'tool_result' && block.is_error === true) {
      hasToolError = true
    }
  }

  if (parallelToolNames.length > 1) {
    acc.parallelToolCallCount++
    if (parallelToolNames.length > acc.maxParallelDegree) {
      acc.maxParallelDegree = parallelToolNames.length
    }
    acc.parallelToolGroups.push({
      turnIndex: acc.turnIndex,
      timestamp: raw.timestamp,
      toolNames: parallelToolNames,
      toolCount: parallelToolNames.length,
    })
  }

  const stopReason = raw.message?.stop_reason ?? undefined
  const effort = classifyEffort(usage.outputTokens, thinkingChars, stopReason)
  acc.effortDist[effort]++

  if (acc.lastMessageTimestamp && raw.timestamp) {
    const durationMs =
      new Date(raw.timestamp).getTime() - new Date(acc.lastMessageTimestamp).getTime()
    if (durationMs > 0 && durationMs <= MAX_TURN_DURATION_MS) {
      acc.turnDurations.push({
        turnIndex: acc.turnIndex,
        prevTimestamp: acc.lastMessageTimestamp,
        assistantTimestamp: raw.timestamp,
        durationMs,
        isPostCompaction: acc.compactionEvents.length > 0 && acc.turnsSinceLastCompaction <= 2,
        inputTokens: usage.inputTokens,
        model: raw.message?.model ?? undefined,
      })
    }
  }
  acc.lastMessageTimestamp = raw.timestamp

  const textContent = extractTextFromContent(blocks)
  const errorClassification = classifyError(textContent, stopReason)
  if (errorClassification) {
    acc.hasError = true
    acc.errorDetails.push({
      classification: errorClassification,
      turnIndex: acc.turnIndex,
      timestamp: raw.timestamp,
      message: textContent.slice(0, ERROR_SNIPPET_MAX_CHARS),
    })
  }

  if (hasToolError) {
    acc.hasError = true
    acc.errorDetails.push({
      classification: 'toolError',
      turnIndex: acc.turnIndex,
      timestamp: raw.timestamp,
      message: 'Tool result contained an error',
    })
  }
}

function processAssistantRecord(
  raw: RawRecord,
  acc: MetadataAccumulator,
  pricingTable: Record<ModelFamily, ModelPricing>
): void {
  acc.messageCount++

  const blocks = getRawBlocks(raw)
  const model = raw.message?.model
  const usage = parseTokenUsage(raw)
  const family = getModelFamily(model)
  const cache5m = usage.cacheCreation?.ephemeral5mInputTokens ?? 0
  const cache1h = usage.cacheCreation?.ephemeral1hInputTokens ?? 0
  const cost = estimateCost(
    family,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadInputTokens,
    cache5m,
    cache1h,
    pricingTable
  )

  if (model) {
    accumulateModelBreakdown(model, usage, cache5m, cache1h, cost, acc)
  }

  accumulateBlockMetrics(blocks, raw, usage, acc)
}

function buildObservability(acc: MetadataAccumulator): SessionObservability {
  const effortEntries = Object.entries(acc.effortDist) as [EffortLevel, number][]
  const dominantEffortLevel = effortEntries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]

  const sortedDurations = [...acc.turnDurations].sort((a, b) => a.durationMs - b.durationMs)
  const medianTurnDurationMs =
    sortedDurations.length > 0
      ? sortedDurations[Math.floor(sortedDurations.length / 2)].durationMs
      : undefined
  const maxTurnDurationMs =
    sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1].durationMs : undefined

  return {
    medianTurnDurationMs,
    maxTurnDurationMs,
    dominantEffortLevel,
    effortDistribution: acc.effortDist,
    errorClassifications: acc.errorDetails.map((e) => e.classification),
    hasIdleZombieGap: acc.hasIdleZombieGap,
    estimatedIdleWasteCost: acc.estimatedIdleWasteCost,
    compactionTimestamps: acc.compactionEvents.map((e) => e.timestamp ?? '').filter(Boolean),
    parallelToolCallCount: acc.parallelToolCallCount,
    maxParallelDegree: acc.maxParallelDegree,
    isWorktreeSession: acc.isWorktreeSession,
  }
}

function buildSessionSummary(
  sessionId: string,
  projectId: string,
  acc: MetadataAccumulator
): SessionSummary {
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheCreation5mTokens = 0
  let totalCacheCreation1hTokens = 0
  let estimatedCost = 0

  for (const breakdown of acc.modelBreakdownMap.values()) {
    totalInputTokens += breakdown.inputTokens
    totalOutputTokens += breakdown.outputTokens
    totalCacheReadTokens += breakdown.cacheReadTokens
    totalCacheCreation5mTokens += breakdown.cacheCreation5mTokens
    totalCacheCreation1hTokens += breakdown.cacheCreation1hTokens
    estimatedCost += breakdown.estimatedCost
  }

  let primaryModel: string | undefined
  let maxTurns = 0
  for (const [model, breakdown] of acc.modelBreakdownMap) {
    if (breakdown.turnCount > maxTurns) {
      maxTurns = breakdown.turnCount
      primaryModel = model
    }
  }

  return {
    id: sessionId,
    projectId,
    projectPath: acc.cwd ?? decodeProjectId(projectId),
    slug: acc.slug,
    title: acc.title,
    firstTimestamp: acc.firstTimestamp ?? '',
    lastTimestamp: acc.lastTimestamp ?? '',
    messageCount: acc.messageCount,
    parentMessageCount: acc.messageCount,
    primaryModel,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens: totalCacheCreation5mTokens + totalCacheCreation1hTokens,
    totalCacheCreation5mTokens,
    totalCacheCreation1hTokens,
    compactionCount: acc.compactionCount,
    totalTokensRemovedByCompaction: acc.compactionEvents.reduce(
      (s, e) => s + (e.preTokens ?? 0),
      0
    ),
    turnDurations: acc.turnDurations,
    estimatedCost,
    hasError: acc.hasError,
    modelBreakdown: Array.from(acc.modelBreakdownMap.values()),
    toolCallCount: acc.toolCallCount,
    observability: buildObservability(acc),
    tags: acc.parallelToolCallCount > 0 ? ['parallel-threads'] : [],
    subagents: [],
  }
}

/**
 * Parse a session JSONL file into a lightweight summary suitable for the
 * project-list / sidebar surfaces. Streams the file line-by-line so files of
 * any size are processed without buffering.
 *
 * Subagent transcripts are parsed in a follow-up pass and rolled into the
 * session totals (their API spend is otherwise invisible to the parent file).
 */
export async function parseSessionMetadata(
  filePath: string,
  sessionId: string,
  projectId: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<SessionSummary> {
  const seenUuids = new Set<string>()
  const acc = createMetadataAccumulator(sessionId)

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

    if (shouldSkipRecord(raw, seenUuids)) continue

    if (raw.slug && !acc.slug) {
      acc.slug = raw.slug
      acc.title = raw.slug
    }

    if (raw.cwd && !acc.cwd) {
      acc.cwd = raw.cwd
    }

    processTimestamps(raw, acc)

    if (raw.subtype === 'compact_boundary') {
      processCompactionBoundary(raw, acc)
      continue
    }

    if (raw.type === 'user' && !isToolResultCarrierUser(raw)) {
      processUserRecord(raw, acc)
    } else if (raw.type === 'user' && raw.timestamp) {
      acc.lastMessageTimestamp = raw.timestamp
    }

    if (raw.type === 'assistant' && !isSyntheticAssistant(raw)) {
      processAssistantRecord(raw, acc, pricingTable)
    }
  }

  const summary = buildSessionSummary(sessionId, projectId, acc)
  summary.subagents = await parseSubagents(filePath, pricingTable)

  // Roll subagent API costs into session totals — subagent turns are separate
  // API calls not reflected in the parent session's message.usage fields.
  for (const sub of summary.subagents) {
    summary.totalInputTokens += sub.totalInputTokens
    summary.totalOutputTokens += sub.totalOutputTokens
    summary.estimatedCost += sub.estimatedCost
    summary.messageCount += sub.messageCount
    for (const bd of sub.modelBreakdown) {
      const existing = summary.modelBreakdown.find((m) => m.model === bd.model)
      if (existing) {
        existing.inputTokens += bd.inputTokens
        existing.outputTokens += bd.outputTokens
        existing.cacheReadTokens += bd.cacheReadTokens
        existing.cacheCreation5mTokens += bd.cacheCreation5mTokens
        existing.cacheCreation1hTokens += bd.cacheCreation1hTokens
        existing.estimatedCost += bd.estimatedCost
        existing.turnCount += bd.turnCount
      } else {
        summary.modelBreakdown.push({ ...bd })
      }
    }
    summary.totalCacheCreationTokens += sub.modelBreakdown.reduce(
      (s, bd) => s + bd.cacheCreation5mTokens + bd.cacheCreation1hTokens,
      0
    )
    summary.totalCacheCreation5mTokens += sub.modelBreakdown.reduce(
      (s, bd) => s + bd.cacheCreation5mTokens,
      0
    )
    summary.totalCacheCreation1hTokens += sub.modelBreakdown.reduce(
      (s, bd) => s + bd.cacheCreation1hTokens,
      0
    )
  }

  return summary
}
