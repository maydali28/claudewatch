import * as fs from 'fs'
import * as readline from 'readline'
import type {
  RawRecord,
  SessionSummary,
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
import { toDayKeyOrUndated, UNDATED_DAY } from '@shared/utils/date-ranges'
import { IDLE_GAP_MS, ERROR_SNIPPET_MAX_CHARS } from '@shared/constants/tuning'
import {
  extractTextFromContent,
  getRawBlocks,
  isSyntheticAssistant,
  isToolResultCarrierUser,
  parseTokenUsage,
} from './parser-helpers'
import { parseSubagents } from './subagent-parser'
import { createResponseAccumulator } from '@main/services/accounting/ledger'
import { projectUsage, type UsageProjection } from '@main/services/accounting/projection'
import {
  createActivityAccumulator,
  type ActivityCounts,
  type DayActivity,
} from '@main/services/parsers/activity-reducer'
import {
  assistantResponseId,
  laterTimestamp,
  judgeResponse,
  type PendingResponse,
} from './response-observability'
import { createLogger } from '@main/lib/logger'

const log = createLogger('MetadataParser')

interface MetadataAccumulator {
  // Identity
  slug: string | undefined
  aiTitle: string | undefined
  cwd: string | undefined

  // Timestamps
  firstTimestamp: string | undefined
  lastTimestamp: string | undefined
  lastTimestampForGap: number | undefined

  // Counters
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

  /**
   * Effort and parallel-tool degree keyed by the calendar day the response
   * was flushed on. Every response carries its own timestamp, so — unlike
   * the lifetime totals above, which a median-vs-max session judgement still
   * needs — these can be attributed to the day they actually happened on
   * instead of charging a one-day view for the session's whole life.
   */
  effortByDay: Map<string, EffortDistribution>
  parallelByDay: Map<string, { groups: number; maxDegree: number }>

  // Turn tracking
  lastMessageTimestamp: string | undefined
  /** See `SessionSummary.turnOpen`. Set by `processTurnState`. */
  turnOpen: boolean
  turnIndex: number
  turnsSinceLastCompaction: number

  /**
   * The response currently being assembled. Content blocks of one API response
   * arrive as separate records, so effort, duration and parallel-tool degree
   * can only be judged once every record for that response has been seen.
   * Measured history: parallel tool use was never detected before this,
   * because each tool_use block lands in its own record.
   *
   * Extends the shared `PendingResponse` shape with `toolNames`: parallel-
   * tool-call detection is specific to this parser (`full-parser.ts`'s twin
   * is confirmed dead code — a content record never holds two tool_use
   * blocks — so it doesn't need this field).
   */
  pendingResponse?: PendingResponse & { toolNames: string[] }
}

function createMetadataAccumulator(): MetadataAccumulator {
  return {
    slug: undefined,
    aiTitle: undefined,
    cwd: undefined,
    firstTimestamp: undefined,
    lastTimestamp: undefined,
    lastTimestampForGap: undefined,
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
    effortByDay: new Map(),
    parallelByDay: new Map(),
    lastMessageTimestamp: undefined,
    turnOpen: false,
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

/**
 * User records Claude Code writes that are never answered by an assistant
 * record. Opening the turn on one would hold the session "live" for the whole
 * `OPEN_TURN_ACTIVE_MS` cap after the user has walked away — where the plain
 * last-write rule dropped it after `ACTIVE_SESSION_MS`. Measured over the
 * local history: local slash commands (`/model`, `/cost`), the caveat that
 * accompanies them, and the Esc interrupt marker. Meta records (`isMeta`) are
 * injected context that always rides alongside a real prompt or tool_result,
 * which is what opens the turn.
 */
const UNANSWERED_USER_PREFIXES = [
  '<command-name>',
  '<local-command-stdout>',
  '<local-command-caveat>',
] as const
const INTERRUPT_PREFIX = '[Request interrupted by user'

function userTurnEffect(raw: RawRecord): 'open' | 'close' | 'none' {
  if (raw.isMeta === true) return 'none'
  if (isToolResultCarrierUser(raw)) return 'open'
  const text = getRawBlocks(raw)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trimStart()
  // An interrupt ENDS whatever was running (a tool call, a generation), so
  // it closes rather than merely not opening.
  if (text.startsWith(INTERRUPT_PREFIX)) return 'close'
  if (UNANSWERED_USER_PREFIXES.some((prefix) => text.startsWith(prefix))) return 'none'
  return 'open'
}

/**
 * Whether the turn is still in progress after this record. Only message
 * records move it — the queue, attachment and prompt-history records Claude
 * Code trails a response with say nothing about the turn. A user record
 * (a prompt, or a tool_result the assistant has yet to react to) opens it,
 * except the never-answered kinds `userTurnEffect` sets aside; a synthetic
 * assistant record (an API error, "no response requested") ends it. A real
 * assistant record is judged in `processAssistantRecord`, off the response's
 * MERGED `stop_reason`, so the two never read the field by different rules.
 */
function processTurnState(raw: RawRecord, acc: MetadataAccumulator): void {
  if (raw.type === 'user') {
    const effect = userTurnEffect(raw)
    if (effect !== 'none') acc.turnOpen = effect === 'open'
  } else if (raw.type === 'assistant' && isSyntheticAssistant(raw)) {
    acc.turnOpen = false
  }
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
  acc.lastMessageTimestamp = _raw.timestamp
  acc.turnIndex++
  acc.turnsSinceLastCompaction++
}

/**
 * Flush the response currently being assembled: one effort vote, one error
 * classification, one turn duration and one parallel-tool group, judged from
 * the union of every record's blocks rather than from a single split-off
 * record. Effort, error and duration are judged by the shared `judgeResponse`
 * (`response-observability.ts`, identical to `full-parser.ts`'s call);
 * parallel-tool grouping and per-day attribution stay local since
 * `full-parser.ts` doesn't need either. Called when the next record belongs
 * to a different response, when a compaction boundary is about to be
 * processed, and once after the read loop so the last response in the file
 * is not silently dropped.
 */
function flushPendingResponse(acc: MetadataAccumulator): void {
  const pending = acc.pendingResponse
  if (!pending) return
  acc.pendingResponse = undefined

  const { effort, errorClassification, turnDuration } = judgeResponse(pending)
  acc.effortDist[effort]++

  // A missing or unparsable timestamp is as undated as the ledger and the
  // activity reducer consider it — `toDayKeyOrUndated` routes either case to
  // the shared `UNDATED_DAY` bucket rather than skipping the per-day maps (a
  // present-but-malformed timestamp used to slip past the old presence-only
  // check here and land under a `NaN-NaN-NaN` key instead).
  const day = toDayKeyOrUndated(pending.timestamp)
  const dayEffort = acc.effortByDay.get(day) ?? { low: 0, medium: 0, high: 0, ultrathink: 0 }
  dayEffort[effort]++
  acc.effortByDay.set(day, dayEffort)

  if (errorClassification) {
    acc.hasError = true
    acc.errorDetails.push({
      classification: errorClassification,
      turnIndex: pending.turnIndex,
      timestamp: pending.timestamp,
      message: pending.errorText.slice(0, ERROR_SNIPPET_MAX_CHARS),
    })
  }

  if (pending.toolNames.length > 1) {
    acc.parallelToolCallCount++
    if (pending.toolNames.length > acc.maxParallelDegree) {
      acc.maxParallelDegree = pending.toolNames.length
    }
    acc.parallelToolGroups.push({
      turnIndex: pending.turnIndex,
      timestamp: pending.timestamp,
      toolNames: pending.toolNames,
      toolCount: pending.toolNames.length,
    })
    const dayParallel = acc.parallelByDay.get(day) ?? { groups: 0, maxDegree: 0 }
    dayParallel.groups++
    dayParallel.maxDegree = Math.max(dayParallel.maxDegree, pending.toolNames.length)
    acc.parallelByDay.set(day, dayParallel)
  }

  if (turnDuration) {
    acc.turnDurations.push(turnDuration)
  }

  // Anchors the next turn's duration. This response no longer flushes on the
  // first non-matching record, so a tool_result-carrying user record between
  // this response's own blocks can already have moved `lastMessageTimestamp`
  // forward (its own handler runs immediately, independent of buffering) to a
  // point later than this response's own first-block `timestamp` — keep
  // whichever is later rather than unconditionally overwriting it, or a
  // flush deferred past such a record would rewind the anchor backwards.
  acc.lastMessageTimestamp = laterTimestamp(acc.lastMessageTimestamp, pending.timestamp)
}

/**
 * Non-usage metrics only. Tokens, cost and model attribution come from the
 * ledger, which counts once per API response rather than once per record —
 * accumulating them here as well would reintroduce the overcount.
 *
 * Buffers into `acc.pendingResponse` rather than judging each record on its
 * own: `thinkingChars` and `toolNames` must accumulate across every record of
 * the response before effort or parallel-tool degree can be judged, and
 * `outputTokens` — identical on every record — is kept as the largest seen,
 * matching the ledger's own snapshot merge. `toolCallCount` is a per-block
 * counter that stays immediate: blocks are not duplicated across records, so
 * summing them per record was already correct.
 */
function processAssistantRecord(
  raw: RawRecord,
  acc: MetadataAccumulator,
  responseId: string
): void {
  const blocks = getRawBlocks(raw)
  const usage = parseTokenUsage(raw)
  const stopReason = raw.message?.stop_reason ?? undefined

  if (!acc.pendingResponse || acc.pendingResponse.responseId !== responseId) {
    // First record of a new response. `prevTimestamp` is captured now, from
    // whatever the last completed turn's timestamp was — not updated as this
    // response's later records arrive. Capturing it any later reproduces the
    // sub-second-gap bug this buffering exists to fix.
    acc.pendingResponse = {
      responseId,
      timestamp: raw.timestamp,
      prevTimestamp: acc.lastMessageTimestamp,
      turnIndex: acc.turnIndex,
      outputTokens: usage.outputTokens,
      inputTokens: usage.inputTokens,
      model: raw.message?.model ?? undefined,
      stopReason,
      thinkingChars: 0,
      errorText: '',
      toolNames: [],
      isPostCompaction: acc.compactionEvents.length > 0 && acc.turnsSinceLastCompaction <= 2,
    }
  } else {
    // Later record of the same response. output_tokens is byte-identical
    // except while streaming revises it upward, so keep the largest.
    if (usage.outputTokens > acc.pendingResponse.outputTokens) {
      acc.pendingResponse.outputTokens = usage.outputTokens
    }
    if (stopReason) {
      acc.pendingResponse.stopReason = stopReason
    }
    // Repair a `timestamp` this response's FIRST record could not supply,
    // when a later record of the same response carries a usable one — the
    // same one-directional relocation `activity-reducer.ts` does with
    // `moveBump` and the ledger's snapshot merge does for `dayLocal`.
    //
    // `timestamp` was captured on the first record and never revisited, so
    // `flushPendingResponse` attributed this response's effort and its
    // parallel-tool group by first-seen date. When that first record's
    // timestamp was absent or malformed, those stayed in `UNDATED_DAY` while
    // the reducer had already moved the same response's messages onto the
    // real calendar day — one response, two buckets, which is the split a
    // single shared undated policy exists to prevent.
    //
    // Only ever out of undated, never into it, and judged through
    // `toDayKeyOrUndated` so the absent and the malformed case are treated
    // alike — a first record timestamped `'invalid'` is as unusable as one
    // with no timestamp at all. A response whose first record already had a
    // usable timestamp is untouched, so the ordinary first-seen attribution
    // (and `prevTimestamp`, which is deliberately NOT revisited — see the
    // first-record branch above) is unchanged.
    if (
      toDayKeyOrUndated(acc.pendingResponse.timestamp) === UNDATED_DAY &&
      toDayKeyOrUndated(raw.timestamp) !== UNDATED_DAY
    ) {
      acc.pendingResponse.timestamp = raw.timestamp
    }
  }

  const pending = acc.pendingResponse
  // Off the merged value, not this record's own field: a later record of the
  // same response may omit `stop_reason` without un-finishing the response.
  // Open while a `tool_use` result is still owed, or while nothing has
  // reported a stop reason yet (still streaming).
  acc.turnOpen = !pending.stopReason || pending.stopReason === 'tool_use'
  let hasToolError = false

  for (const block of blocks) {
    if (block.type === 'thinking') {
      pending.thinkingChars += block.thinking?.length ?? 0
    }
    if (block.type === 'tool_use') {
      acc.toolCallCount++
      pending.toolNames.push(block.name ?? '')
      if (block.name === 'EnterWorktree' || block.name === 'ExitWorktree') {
        acc.isWorktreeSession = true
      }
    }
    if (block.type === 'tool_result' && block.is_error === true) {
      hasToolError = true
    }
  }

  // Error/truncation classification is judged once per response, in
  // `flushPendingResponse`, from this accumulated text — not here per
  // record. `stop_reason` repeats on every record of a response, so
  // classifying it record-by-record pushed one `maxTokensTruncation` entry
  // per record instead of one per truncated response.
  const textContent = extractTextFromContent(blocks)
  if (textContent) {
    pending.errorText += (pending.errorText ? ' ' : '') + textContent
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
  usage: UsageProjection,
  activity: ActivityCounts,
  childActivityByDay: Map<string, DayActivity>,
  diagnostics: SessionSummary['diagnostics']
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
    thinkingTokens,
  } = usage.combined

  // Compaction events carry their own timestamps, so they belong to the day
  // they happened on rather than to the session as a whole. `maxPreTokens`
  // rides alongside the sum so a later rollup can take max-of-maxes for a true
  // peak; max-of-sums (or dividing the sum by the count) would not be one.
  // A missing or unparsable `event.timestamp` lands in the shared
  // `UNDATED_DAY` bucket via `toDayKeyOrUndated` rather than being dropped
  // (the old code silently skipped a missing timestamp, and would have handed
  // a present-but-malformed one straight to `toDateKey`, producing the
  // `NaN-NaN-NaN` key).
  const compactionsByDay = new Map<
    string,
    { count: number; tokens: number; maxPreTokens: number }
  >()
  for (const event of acc.compactionEvents) {
    const key = toDayKeyOrUndated(event.timestamp)
    const entry = compactionsByDay.get(key) ?? { count: 0, tokens: 0, maxPreTokens: 0 }
    entry.count++
    entry.tokens += event.preTokens ?? 0
    entry.maxPreTokens = Math.max(entry.maxPreTokens, event.preTokens ?? 0)
    compactionsByDay.set(key, entry)
  }

  return {
    id: sessionId,
    projectId,
    projectPath: acc.cwd ?? decodeProjectId(projectId),
    slug: acc.slug,
    // Display name precedence: Claude's generated name, then the slug (only
    // written by older Claude Code versions), then the bare session id.
    title: acc.aiTitle ?? acc.slug ?? sessionId,
    firstTimestamp: acc.firstTimestamp ?? '',
    lastTimestamp: acc.lastTimestamp ?? '',
    turnOpen: acc.turnOpen,
    messageCount: activity.total,
    parentMessageCount: activity.total,
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
    toolCallCount: acc.toolCallCount,
    observability: buildObservability(acc),
    tags: acc.parallelToolCallCount > 0 ? ['parallel-threads'] : [],
    subagents: [],
    dailyUsage: buildDailyUsage(
      usage,
      activity,
      childActivityByDay,
      compactionsByDay,
      acc.effortByDay,
      acc.parallelByDay
    ),
    diagnostics,
    thinkingTokens,
    recordedEffortDistribution: usage.recordedEffortDistribution,
    serviceTiers: usage.serviceTiers,
  }
}

function buildDailyUsage(
  usage: UsageProjection,
  activity: ActivityCounts,
  childActivityByDay: Map<string, DayActivity>,
  compactionsByDay: Map<string, { count: number; tokens: number; maxPreTokens: number }>,
  effortByDay: Map<string, EffortDistribution>,
  parallelByDay: Map<string, { groups: number; maxDegree: number }>
): SessionSummary['dailyUsage'] {
  const usageByDay = new Map(usage.byDay.map((d) => [d.day, d]))
  // A day exists if anything happened on it: billable usage, a message, a
  // compaction, or a response whose effort/parallelism was judged. Building
  // only from usage drops a day whose prompt drew no assistant response.
  const dayKeys = new Set<string>([
    ...usage.byDay.map((d) => d.day),
    ...activity.byDay.keys(),
    ...childActivityByDay.keys(),
    ...compactionsByDay.keys(),
    ...effortByDay.keys(),
    ...parallelByDay.keys(),
  ])

  return [...dayKeys].sort().map((day) => {
    const d = usageByDay.get(day)
    // Parent and child activity for this day. Never falls back to
    // responseCount: a response count and a message count are different
    // quantities.
    const parentDayActivity = activity.byDay.get(day)
    const parentMessages = (parentDayActivity?.user ?? 0) + (parentDayActivity?.assistant ?? 0)
    const childDayActivity = childActivityByDay.get(day)
    const childMessages = (childDayActivity?.user ?? 0) + (childDayActivity?.assistant ?? 0)

    return {
      day,
      inputTokens: d?.inputTokens ?? 0,
      outputTokens: d?.outputTokens ?? 0,
      cacheReadTokens: d?.cacheReadTokens ?? 0,
      cacheCreation5mTokens: d?.cacheWrite5m ?? 0,
      cacheCreation1hTokens: d?.cacheWrite1h ?? 0,
      cacheCreationTokens: d?.cacheWriteTotal ?? 0,
      estimatedCost: d?.estimatedCost ?? 0,
      unpricedResponses: d?.unpricedResponses ?? 0,
      incompleteUsageResponses: d?.incompleteUsageResponses ?? 0,
      responsesWithoutCompletionSignal: d?.responsesWithoutCompletionSignal ?? 0,
      reducedConfidenceResponses: d?.reducedConfidenceResponses ?? 0,
      pricingModifierResponses: d?.pricingModifierResponses ?? 0,
      serverToolRequests: d?.serverToolRequests ?? 0,
      responseCount: d?.responseCount ?? 0,
      parentMessageCount: parentMessages,
      childMessageCount: childMessages,
      messageCount: parentMessages + childMessages,
      parentEstimatedCost: d?.parentEstimatedCost ?? 0,
      compactions: compactionsByDay.get(day)?.count ?? 0,
      tokensRemovedByCompaction: compactionsByDay.get(day)?.tokens ?? 0,
      maxPreCompactionTokens: compactionsByDay.get(day)?.maxPreTokens ?? 0,
      effortDistribution: effortByDay.get(day) ?? { low: 0, medium: 0, high: 0, ultrathink: 0 },
      parallelToolGroups: parallelByDay.get(day)?.groups ?? 0,
      maxParallelDegree: parallelByDay.get(day)?.maxDegree ?? 0,
      models: (d?.models ?? []).map((m) => ({
        model: m.model,
        family: m.family,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheCreation5mTokens: m.cacheWrite5m,
        cacheCreation1hTokens: m.cacheWrite1h,
        cacheCreationUnknownTtlTokens: m.cacheWriteUnknownTtl,
        // Preserve null: this exact model's price is unknown, not zero.
        estimatedCost: m.estimatedCost,
        turnCount: m.turnCount,
      })),
    }
  })
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
  const acc = createMetadataAccumulator()
  // Usage is accounted by the ledger, from this same pass. The accumulator
  // below collects only the non-usage metadata (timings, tool calls,
  // compaction, errors) that the ledger does not describe.
  const ledger = createResponseAccumulator(
    filePath,
    { kind: 'parent', projectId, sessionId },
    pricingTable
  )
  // Message counts come from the same response-grouping the ledger uses for
  // usage, so a block-split response counts once for both.
  const activity = createActivityAccumulator()
  // Counted, not swallowed — see `SessionSummary.diagnostics`.
  let malformedLines = 0

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
      malformedLines++
      continue
    }

    if (shouldSkipRecord(raw, seenUuids)) continue

    if (raw.slug && !acc.slug) acc.slug = raw.slug
    if (raw.type === 'ai-title') {
      const title = raw.aiTitle?.trim()
      if (title) acc.aiTitle = title
      continue
    }

    if (raw.cwd && !acc.cwd) {
      acc.cwd = raw.cwd
    }

    processTimestamps(raw, acc)
    processTurnState(raw, acc)

    const responseId =
      raw.type === 'assistant' && !isSyntheticAssistant(raw) ? assistantResponseId(raw) : undefined

    // Only a genuinely different assistant response ends the buffered one.
    // Claude Code interleaves tool_result-carrying user records BETWEEN the
    // tool_use blocks of a single multi-tool response — measured at 12.3% of
    // responses across real history, precisely the multi-tool-call responses
    // this task's parallel-tool detection exists for. Treating any non-match
    // (including "this record has no response id at all") as end-of-response
    // would flush before the response's last block arrives, undercounting the
    // very thing this task fixes.
    if (
      responseId !== undefined &&
      acc.pendingResponse &&
      acc.pendingResponse.responseId !== responseId
    ) {
      flushPendingResponse(acc)
    }

    if (raw.subtype === 'compact_boundary') {
      // A compaction cannot be allowed to land inside a response; flushing
      // here is unconditional and a no-op when nothing is pending.
      flushPendingResponse(acc)
      processCompactionBoundary(raw, acc)
      continue
    }

    if (raw.type === 'user' && !isToolResultCarrierUser(raw)) {
      processUserRecord(raw, acc)
    } else if (raw.type === 'user' && raw.timestamp) {
      acc.lastMessageTimestamp = raw.timestamp
    }

    activity.add(raw)
    ledger.add(raw)

    if (responseId !== undefined) {
      processAssistantRecord(raw, acc, responseId)
    }
  }

  // The last response in the file has no following record to trigger its
  // flush, so it would otherwise be silently dropped.
  flushPendingResponse(acc)

  // Subagent turns are separate API calls the parent transcript never records,
  // so their usage is rolled in. Rolling up through the ledger rather than by
  // hand is what makes every category reconcile: the previous version added
  // input, output, cost and cache writes but silently omitted cache reads, so a
  // session's totals disagreed with its own model breakdown.
  const {
    summaries,
    entries: childEntries,
    childActivityByDay,
    diagnostics: childDiagnostics,
  } = await parseSubagents(filePath, sessionId, projectId, pricingTable)

  const usage = projectUsage([...ledger.entries(), ...childEntries])
  // A tripwire, not an expected condition — see `ResponseEntry.usageIncomplete`.
  // Logged once per parse rather than per response so a session with many such
  // responses does not flood the log. Goes through the shared logger (not
  // console.warn) so it lands in the persisted log file diagnostics are read
  // from in a packaged build, same as every sibling warning in main/services/.
  if (usage.combined.incompleteUsageResponses > 0) {
    log.warn(
      `${sessionId}: ${usage.combined.incompleteUsageResponses} response(s) with an unpriceable or unreadable usage shape (tier/flat mismatch, a multi-iteration array, or a missing/invalid counter)`
    )
  }
  // Not a tripwire like the one above — a response with no `message.id` is
  // still fully priced, just less reconcilable against Anthropic's own
  // request logs. Worth a log line precisely because it has been silent
  // until now; see `ResponseEntry.reducedConfidenceId`.
  if (usage.combined.reducedConfidenceResponses > 0) {
    log.warn(
      `${sessionId}: ${usage.combined.reducedConfidenceResponses} response(s) with no message.id, identified by record uuid instead`
    )
  }

  // Unlike `full-parser.ts`, `usage` above is already built from
  // `[...ledger.entries(), ...childEntries]`, so `usage.combined.*` is
  // already the parent+child total for every one of these fields — not
  // "copied from the parent alone". Reading it directly here is the correct
  // combination, not a shortcut past one.
  const diagnostics: SessionSummary['diagnostics'] = {
    malformedLines: malformedLines + childDiagnostics.malformedLines,
    unreadableChildren: childDiagnostics.unreadableChildren,
    negativeCounters: ledger.negativeCounters() + childDiagnostics.negativeCounters,
    conflictCount: usage.conflictCount,
    unpricedResponses: usage.combined.unpricedResponses,
    incompleteUsageResponses: usage.combined.incompleteUsageResponses,
    responsesWithoutCompletionSignal: usage.combined.responsesWithoutCompletionSignal,
    reducedConfidenceResponses: usage.combined.reducedConfidenceResponses,
    pricingModifierResponses: usage.combined.pricingModifierResponses,
    serverToolRequests: usage.combined.serverToolRequests,
  }
  // Same rationale as the incompleteUsageResponses warning above: once per
  // parse, through the shared logger, so bad input shows up in the persisted
  // log instead of only in a UI a user might not open.
  if (diagnostics.malformedLines > 0 || diagnostics.unreadableChildren > 0) {
    log.warn(
      `${sessionId}: ${diagnostics.malformedLines} malformed line(s), ${diagnostics.unreadableChildren} unreadable subagent file(s)`
    )
  }

  const activityCounts = activity.counts()
  const summary = buildSessionSummary(
    sessionId,
    projectId,
    acc,
    usage,
    activityCounts,
    childActivityByDay,
    diagnostics
  )

  summary.subagents = summaries
  summary.parentMessageCount = activityCounts.total
  summary.messageCount = activityCounts.total + summaries.reduce((s, x) => s + x.messageCount, 0)

  return summary
}
