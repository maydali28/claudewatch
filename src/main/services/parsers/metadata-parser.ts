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
  SessionObservability,
  EffortDistribution,
} from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { decodeProjectId } from '@shared/utils/decode-project-id'
import { toDateKey } from '@shared/utils/date-ranges'
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
import { createResponseAccumulator } from '@main/services/accounting/ledger'
import { projectUsage, type UsageProjection } from '@main/services/accounting/projection'

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

  /** Messages per local day, so daily series report real per-day activity. */
  messagesByDay: Map<string, number>

  // Turn tracking
  lastMessageTimestamp: string | undefined
  turnIndex: number
  turnsSinceLastCompaction: number
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
    messagesByDay: new Map(),
    lastMessageTimestamp: undefined,
    turnIndex: 0,
    turnsSinceLastCompaction: 0,
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

function countMessageOnDay(raw: RawRecord, acc: MetadataAccumulator): void {
  if (!raw.timestamp) return
  const day = toDateKey(raw.timestamp)
  acc.messagesByDay.set(day, (acc.messagesByDay.get(day) ?? 0) + 1)
}

function processUserRecord(_raw: RawRecord, acc: MetadataAccumulator): void {
  acc.messageCount++
  countMessageOnDay(_raw, acc)
  acc.lastMessageTimestamp = _raw.timestamp
  acc.turnIndex++
  acc.turnsSinceLastCompaction++
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

/**
 * Non-usage metrics only. Tokens, cost and model attribution come from the
 * ledger, which counts once per API response rather than once per record —
 * accumulating them here as well would reintroduce the overcount.
 */
function processAssistantRecord(raw: RawRecord, acc: MetadataAccumulator): void {
  acc.messageCount++
  countMessageOnDay(raw, acc)
  accumulateBlockMetrics(getRawBlocks(raw), raw, parseTokenUsage(raw), acc)
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
  acc: MetadataAccumulator,
  usage: UsageProjection
): SessionSummary {
  const {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheReadTokens: totalCacheReadTokens,
    cacheWrite5m: totalCacheCreation5mTokens,
    cacheWrite1h: totalCacheCreation1hTokens,
    cacheWriteTotal,
    estimatedCost,
    unpricedResponses,
  } = usage.combined

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
    primaryModel: usage.dominantParentModel,
    latestModel: usage.latestParentModel,
    dominantModel: usage.dominantParentModel,
    modelsUsed: usage.modelsUsed,
    unpricedResponses,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    // The flat counter, not the sum of tiers — an unsplit legacy write has no
    // tiers and would otherwise vanish from the total.
    totalCacheCreationTokens: cacheWriteTotal,
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
    modelBreakdown: usage.modelBreakdown.map((m) => ({
      model: m.model,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheCreation5mTokens: m.cacheWrite5m,
      cacheCreation1hTokens: m.cacheWrite1h,
      estimatedCost: m.estimatedCost ?? 0,
      turnCount: m.turnCount,
    })),
    toolCallCount: acc.toolCallCount,
    observability: buildObservability(acc),
    tags: acc.parallelToolCallCount > 0 ? ['parallel-threads'] : [],
    subagents: [],
    dailyUsage: usage.byDay.map((d) => ({
      day: d.day,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
      cacheCreation5mTokens: d.cacheWrite5m,
      cacheCreation1hTokens: d.cacheWrite1h,
      cacheCreationTokens: d.cacheWriteTotal,
      estimatedCost: d.estimatedCost,
      responseCount: d.responseCount,
      // Falls back to the response count for days that only a subagent was
      // active on — the parent transcript records no message there.
      messageCount: acc.messagesByDay.get(d.day) ?? d.responseCount,
      models: d.models.map((m) => ({
        model: m.model,
        family: m.family,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheCreation5mTokens: m.cacheWrite5m,
        cacheCreation1hTokens: m.cacheWrite1h,
        estimatedCost: m.estimatedCost ?? 0,
        turnCount: m.turnCount,
      })),
    })),
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
  // Usage is accounted by the ledger, from this same pass. The accumulator
  // below collects only the non-usage metadata (timings, tool calls,
  // compaction, errors) that the ledger does not describe.
  const ledger = createResponseAccumulator(
    filePath,
    { kind: 'parent', projectId, sessionId },
    pricingTable
  )

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

    ledger.add(raw)

    if (raw.type === 'assistant' && !isSyntheticAssistant(raw)) {
      processAssistantRecord(raw, acc)
    }
  }

  // Subagent turns are separate API calls the parent transcript never records,
  // so their usage is rolled in. Rolling up through the ledger rather than by
  // hand is what makes every category reconcile: the previous version added
  // input, output, cost and cache writes but silently omitted cache reads, so a
  // session's totals disagreed with its own model breakdown.
  const { summaries, entries: childEntries } = await parseSubagents(
    filePath,
    sessionId,
    projectId,
    pricingTable
  )

  const usage = projectUsage([...ledger.entries(), ...childEntries])
  const summary = buildSessionSummary(sessionId, projectId, acc, usage)

  summary.subagents = summaries
  summary.parentMessageCount = acc.messageCount
  summary.messageCount = acc.messageCount + summaries.reduce((s, x) => s + x.messageCount, 0)

  return summary
}
