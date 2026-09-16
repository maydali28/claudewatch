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
  ResolvedResponseUsage,
} from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { ERROR_SNIPPET_MAX_CHARS } from '@shared/constants/tuning'
import { toDayKeyOrUndated, UNDATED_DAY } from '@shared/utils/date-ranges'
import {
  getRawBlocks,
  isSyntheticAssistant,
  isToolResultCarrierUser,
  parseTokenUsage,
} from './parser-helpers'
import { parseSubagents } from './subagent-parser'
import {
  createResponseAccumulator,
  effectiveCacheWriteTotal,
} from '@main/services/accounting/ledger'
import { projectUsage } from '@main/services/accounting/projection'
import { createActivityAccumulator } from './activity-reducer'
import {
  assistantResponseId,
  laterTimestamp,
  judgeResponse,
  type PendingResponse,
} from './response-observability'
import { createLogger } from '@main/lib/logger'

const log = createLogger('FullParser')

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
  // No default: an empty table silently priced every subagent turn at zero, and
  // the export path did exactly that. Callers must supply the active table.
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<ParsedSession> {
  const seenUuids = new Set<string>()
  // Usage is accounted once per API response. The records array below still
  // keeps every transcript record — deduplicating the accounting must not
  // remove anything the reader sees.
  const ledger = createResponseAccumulator(
    filePath,
    { kind: 'parent', projectId, sessionId },
    pricingTable
  )
  const records: ParsedRecord[] = []
  const toolResultMap: Record<string, ToolResultEntry> = {}
  // Message counts come from the same response-grouping the ledger uses for
  // usage, so a block-split response counts once here too, matching the
  // sessions sidebar. See `activity-reducer.ts`.
  const activity = createActivityAccumulator()

  let slug: string | undefined
  let parentSessionId: string | undefined
  let isSubagent = false

  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined
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
  let pendingResponse: PendingResponse | undefined

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  // Counted, not swallowed. This path (the conversation viewer / export) has
  // no SessionSummary to surface diagnostics on, so it logs instead — same
  // rationale as metadata-parser's warning, one line per parse.
  let malformedLines = 0

  /**
   * Flush the response currently being assembled: one effort vote, one error
   * classification and one turn duration, judged from the union of every
   * record's blocks rather than a single split-off record — see
   * `judgeResponse` in `response-observability.ts`, shared with
   * `metadata-parser.ts`'s identical `flushPendingResponse`. Called when the
   * next record belongs to a different response, when a compaction boundary
   * is about to be processed, and once after the read loop so the file's
   * last response is not dropped.
   */
  function flushPendingResponse(): void {
    const pending = pendingResponse
    if (!pending) return
    pendingResponse = undefined

    const { effort, errorClassification, turnDuration } = judgeResponse(pending)
    effortDist[effort]++

    if (errorClassification) {
      errorDetails.push({
        classification: errorClassification,
        turnIndex: pending.turnIndex,
        timestamp: pending.timestamp,
        message: pending.errorText.slice(0, ERROR_SNIPPET_MAX_CHARS),
      })
    }

    if (turnDuration) {
      turnDurations.push(turnDuration)
    }

    // Anchors the next turn's duration. A tool_result-carrying user record
    // between this response's own blocks can already have moved
    // `lastMessageTimestamp` forward to a point later than this response's
    // own first-block timestamp — keep whichever is later rather than
    // unconditionally overwriting it, or a flush deferred past such a record
    // would rewind the anchor backwards.
    lastMessageTimestamp = laterTimestamp(lastMessageTimestamp, pending.timestamp)
  }

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

    if (raw.isCompactSummary === true) continue
    if (raw.type === 'progress') continue
    if (raw.isVisibleInTranscriptOnly === true) continue

    if (raw.uuid) {
      if (seenUuids.has(raw.uuid)) continue
      seenUuids.add(raw.uuid)
    }

    ledger.add(raw)
    // Fed unconditionally, like the ledger above — the accumulator does its
    // own filtering (compact summaries, progress, replayed uuids, tool-result
    // carriers, synthetic assistants) internally, matching what the ledger
    // and `metadata-parser.ts` already exclude.
    activity.add(raw)

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

    // Response id this record belongs to, if it is a real (non-synthetic)
    // assistant record. Computed up front, before the compaction check below,
    // so a response can be flushed before a boundary that falls inside it.
    const responseId =
      raw.type === 'assistant' && !isSyntheticAssistant(raw) ? assistantResponseId(raw) : undefined

    // Only a genuinely different assistant response ends the buffered one —
    // see `metadata-parser.ts`'s identical check for why a tool_result-
    // carrying user record (12.3% of responses, interleaved between
    // tool_use blocks) must not count as one.
    if (responseId !== undefined && pendingResponse && pendingResponse.responseId !== responseId) {
      flushPendingResponse()
    }

    const isCompactionBoundary = raw.subtype === 'compact_boundary'
    if (isCompactionBoundary) {
      // A compaction cannot be allowed to land inside a response; flushing
      // here is unconditional and a no-op when nothing is pending.
      flushPendingResponse()
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
      // Same value already computed above for the flush check; carried onto
      // the record itself so a consumer working from `ParsedSession` alone
      // (the CSV export, in particular) can still recognise which records
      // share one API response without re-deriving it from raw JSONL.
      responseId,
    }

    const shouldExcludeFromRecords =
      (raw.type === 'user' && isToolResultCarrierUser(raw)) ||
      (raw.type === 'assistant' && isSyntheticAssistant(raw))

    if (!shouldExcludeFromRecords) {
      records.push(record)
    }

    // Metadata accumulation. Message counts themselves come from `activity`
    // above, not from these branches — see the `activity.counts()` call
    // after the loop.
    if (raw.type === 'user' && !isToolResultCarrierUser(raw)) {
      lastMessageTimestamp = raw.timestamp
      turnIndex++
      turnsSinceLastCompaction++
    } else if (raw.type === 'user' && raw.timestamp) {
      lastMessageTimestamp = raw.timestamp
    }

    if (responseId !== undefined) {
      const model = raw.message?.model
      if (model) modelsSet.add(model)

      const stopReason = raw.message?.stop_reason ?? undefined

      // Buffer effort/duration inputs into the pending response rather than
      // judging this one record: thinking chars and output tokens must
      // accumulate across every block of the response first. Mirrors
      // `metadata-parser.ts`'s `processAssistantRecord`.
      if (!pendingResponse || pendingResponse.responseId !== responseId) {
        // First record of a new response. `prevTimestamp` is captured now,
        // from whatever the last completed turn's timestamp was — not
        // updated as this response's later records arrive, or the turn
        // duration would shrink to the gap between this response's own
        // interleaved blocks instead of the real thinking time.
        pendingResponse = {
          responseId,
          timestamp: raw.timestamp,
          prevTimestamp: lastMessageTimestamp,
          turnIndex,
          outputTokens: usage.outputTokens,
          inputTokens: usage.inputTokens,
          model: model ?? undefined,
          stopReason,
          thinkingChars: 0,
          errorText: '',
          isPostCompaction: compactionEvents.length > 0 && turnsSinceLastCompaction <= 2,
        }
      } else {
        // Later record of the same response. output_tokens is byte-identical
        // except while streaming revises it upward, so keep the largest;
        // stopReason is adopted from whichever record last carried a
        // truthy one, matching `metadata-parser.ts` — an intermediate
        // record with no `stop_reason` yet must not overwrite one a later
        // record does carry.
        if (usage.outputTokens > pendingResponse.outputTokens) {
          pendingResponse.outputTokens = usage.outputTokens
        }
        if (stopReason) {
          pendingResponse.stopReason = stopReason
        }
        // Same first-record timestamp repair `metadata-parser.ts`'s twin of
        // this block performs — see the long comment there for why one
        // response must not end up attributed two different ways. Kept in
        // step here deliberately: these two merge paths diverging is how the
        // split this repair fixes came about in the first place. `timestamp`
        // feeds this parser's `errorDetails` and, through `judgeResponse`,
        // its `turnDurations` — a turn whose first record was undated
        // produced a `NaN` duration and was dropped entirely.
        if (
          toDayKeyOrUndated(pendingResponse.timestamp) === UNDATED_DAY &&
          toDayKeyOrUndated(raw.timestamp) !== UNDATED_DAY
        ) {
          pendingResponse.timestamp = raw.timestamp
        }
      }
      pendingResponse.thinkingChars += assistantThinkingChars
      // Error/truncation classification is judged once per response, in
      // `flushPendingResponse`, from this accumulated text — not here per
      // record. `stop_reason` repeats on every record of a response, so
      // classifying it record-by-record pushed one `maxTokensTruncation`
      // entry per record instead of one per truncated response.
      if (assistantErrorText) {
        pendingResponse.errorText += (pendingResponse.errorText ? ' ' : '') + assistantErrorText
      }

      // Parallel-tool detection stays per-record and deliberately unfixed: a
      // content record never holds more than one tool_use block (each lands
      // in its own record, same as thinking/text), so this condition can
      // never fire and `parallelToolGroups` here is permanently empty.
      // Confirmed nothing in src/renderer reads it — the dashboards use a
      // separate, already-correct day-level aggregation — so it's left as
      // dead code rather than given the buffering treatment its twin in
      // `metadata-parser.ts` has.
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

  // The last response in the file has no following record to trigger its
  // flush, so it would otherwise be silently dropped.
  flushPendingResponse()
  const activityCounts = activity.counts()
  const messageCount = activityCounts.total
  const userMessageCount = activityCounts.userMessages
  const assistantMessageCount = activityCounts.assistantResponses

  const { summaries: subagents, diagnostics: childDiagnostics } = await parseSubagents(
    filePath,
    sessionId,
    projectId,
    pricingTable
  )

  const totalMalformedLines = malformedLines + childDiagnostics.malformedLines
  const negativeCounters = ledger.negativeCounters() + childDiagnostics.negativeCounters
  if (totalMalformedLines > 0 || childDiagnostics.unreadableChildren > 0 || negativeCounters > 0) {
    log.warn(
      `${sessionId}: ${totalMalformedLines} malformed line(s), ${childDiagnostics.unreadableChildren} unreadable subagent file(s), ${negativeCounters} rejected negative counter(s)`
    )
  }

  // Parent entries only — unlike `metadata-parser.ts`, this `usage` never
  // includes `childEntries`, so every field below it that must reflect the
  // whole session (parent + subagents) has to be combined with
  // `childDiagnostics` explicitly, the same way `totalMalformedLines` and
  // `negativeCounters` above already are. Reading `usage.combined.*` alone
  // here would silently report only the parent's share.
  const parentEntries = ledger.entries()
  const usage = projectUsage(parentEntries)
  const totalInputTokens = usage.combined.inputTokens
  const totalOutputTokens = usage.combined.outputTokens
  const totalCacheReadTokens = usage.combined.cacheReadTokens
  const totalCacheCreationTokens = usage.combined.cacheWriteTotal

  // See `ParsedSession.responseUsage`'s own doc comment. Built from the same
  // parent-only ledger entries `totalOutputTokens` etc. above are summed
  // from — not a second, independent re-derivation from raw records — so a
  // consumer keyed on `responseId` (the CSV export, in particular) reads the
  // response's MERGED total rather than whichever record's snapshot happened
  // to be written first.
  const responseUsage: Record<string, ResolvedResponseUsage> = {}
  for (const entry of parentEntries) {
    responseUsage[entry.responseId] = {
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheCreationTokens: effectiveCacheWriteTotal(entry),
      costUsd: entry.costUsd,
    }
  }

  // Mirrors `metadata-parser.ts`'s `diagnostics` build in shape — same eight
  // counts — but not for free: metadata-parser's `usage` already projects
  // parent+child entries together, so reading `usage.combined.*`/
  // `usage.conflictCount` there already IS the combined total. This parser's
  // `usage` is parent-only (see the comment above `parentEntries`), so every
  // count that HAS a parent-side figure must be assembled by explicitly adding
  // the matching `childDiagnostics` one. (`unreadableChildren` is the lone
  // exception: it describes child files only, so it passes straight through
  // with nothing to add it to.) `conflictCount` is included in that rule, even
  // though it lives outside `usage.combined` as `UsageProjection`'s own
  // top-level counter. That was, in fact, the one count this build used to
  // get wrong: it read `usage.conflictCount` alone and dropped every
  // subagent-only conflict, silently, until `SubagentDiagnostics` grew its
  // own `conflictCount` to add here.
  const diagnostics: ParsedSession['diagnostics'] = {
    malformedLines: totalMalformedLines,
    unreadableChildren: childDiagnostics.unreadableChildren,
    negativeCounters,
    conflictCount: usage.conflictCount + childDiagnostics.conflictCount,
    unpricedResponses: usage.combined.unpricedResponses + childDiagnostics.unpricedResponses,
    incompleteUsageResponses:
      usage.combined.incompleteUsageResponses + childDiagnostics.incompleteUsageResponses,
    responsesWithoutCompletionSignal:
      usage.combined.responsesWithoutCompletionSignal +
      childDiagnostics.responsesWithoutCompletionSignal,
    reducedConfidenceResponses:
      usage.combined.reducedConfidenceResponses + childDiagnostics.reducedConfidenceResponses,
  }

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
    diagnostics,
    responseUsage,
  }
}
