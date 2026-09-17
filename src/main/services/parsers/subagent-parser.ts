import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import type { RawRecord, SubagentSummary } from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { pLimit } from '@main/lib/p-limit'
import { SUBAGENT_PARSE_CONCURRENCY } from '@shared/constants/tuning'
import {
  createResponseAccumulator,
  type ResponseEntry,
  type SourceIdentity,
} from '@main/services/accounting/ledger'
import { projectUsage } from '@main/services/accounting/projection'
import { createActivityAccumulator, type DayActivity } from './activity-reducer'

/**
 * See `SessionSummary.diagnostics` — this is that shape, scoped to subagents.
 *
 * The four usage-completeness fields and `conflictCount` are read from each
 * child's own `projectUsage(entries)` (see `parseSingleSubagent` below) and
 * summed across every subagent file, the same way `malformedLines` etc. are
 * — the parent parsers that combine per-agent diagnostics into a session
 * total need this aggregate, or child-session completeness (and child usage
 * conflicts) silently reads as zero while looking measured. `conflictCount`
 * was the one field missing here until it caused exactly that: it lives
 * outside `UsageProjection.combined` as that projection's own top-level
 * counter, so `full-parser.ts` reading `usage.conflictCount` from its
 * parent-only projection had no per-child figure to add it to.
 */
export interface SubagentDiagnostics {
  malformedLines: number
  unreadableChildren: number
  negativeCounters: number
  conflictCount: number
  unpricedResponses: number
  incompleteUsageResponses: number
  responsesWithoutCompletionSignal: number
  reducedConfidenceResponses: number
  pricingModifierResponses: number
  serverToolRequests: number
}

export interface SubagentParseResult {
  summaries: SubagentSummary[]
  /** Ledger entries for every subagent, for rollup into the parent session. */
  entries: ResponseEntry[]
  /** Every subagent's per-day activity, summed into one map keyed by local day. */
  childActivityByDay: Map<string, DayActivity>
  /** Summed across every subagent file discovered, readable or not. */
  diagnostics: SubagentDiagnostics
}

/**
 * Discover and parse subagent transcripts written alongside a session.
 *
 * Subagents (Task tool) get their own JSONL files in
 * `<session>/subagents/agent-<id>.jsonl`. Their usage is real API spend that
 * the parent transcript does not record, so it must be rolled up — including
 * cache reads, which the previous implementation dropped.
 */
export async function parseSubagents(
  sessionFilePath: string,
  sessionId: string,
  projectId: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<SubagentParseResult> {
  const sessionDir = sessionFilePath.replace(/\.jsonl$/, '')
  const subagentsDir = path.join(sessionDir, 'subagents')

  let files: string[]
  try {
    const dirEntries = await fs.promises.readdir(subagentsDir, { withFileTypes: true })
    files = dirEntries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl') && !e.name.includes('compact'))
      .map((e) => e.name)
  } catch {
    // No subagents directory at all is a normal, common outcome (most
    // sessions have no subagents) — not a read failure worth counting.
    return {
      summaries: [],
      entries: [],
      childActivityByDay: new Map(),
      diagnostics: {
        malformedLines: 0,
        unreadableChildren: 0,
        negativeCounters: 0,
        conflictCount: 0,
        unpricedResponses: 0,
        incompleteUsageResponses: 0,
        responsesWithoutCompletionSignal: 0,
        reducedConfidenceResponses: 0,
        pricingModifierResponses: 0,
        serverToolRequests: 0,
      },
    }
  }

  // Bounded: a single session can have hundreds of subagents, and an unbounded
  // fan-out opens that many file handles at once.
  const limit = pLimit(SUBAGENT_PARSE_CONCURRENCY)
  const parsed = await Promise.all(
    files.map((file) =>
      limit(() =>
        parseSingleSubagent(path.join(subagentsDir, file), file, sessionId, projectId, pricingTable)
      )
    )
  )

  const summaries: SubagentSummary[] = []
  const entries: ResponseEntry[] = []
  // Summed rather than kept per-child: the parent only needs one figure per
  // day, and a child's own byDay map is not otherwise exposed anywhere.
  const childActivityByDay = new Map<string, DayActivity>()
  const diagnostics: SubagentDiagnostics = {
    malformedLines: 0,
    unreadableChildren: 0,
    negativeCounters: 0,
    conflictCount: 0,
    unpricedResponses: 0,
    incompleteUsageResponses: 0,
    responsesWithoutCompletionSignal: 0,
    reducedConfidenceResponses: 0,
    pricingModifierResponses: 0,
    serverToolRequests: 0,
  }
  for (const result of parsed) {
    diagnostics.malformedLines += result.diagnostics.malformedLines
    diagnostics.unreadableChildren += result.diagnostics.unreadableChildren
    diagnostics.negativeCounters += result.diagnostics.negativeCounters
    diagnostics.conflictCount += result.diagnostics.conflictCount
    diagnostics.unpricedResponses += result.diagnostics.unpricedResponses
    diagnostics.incompleteUsageResponses += result.diagnostics.incompleteUsageResponses
    diagnostics.responsesWithoutCompletionSignal +=
      result.diagnostics.responsesWithoutCompletionSignal
    diagnostics.reducedConfidenceResponses += result.diagnostics.reducedConfidenceResponses
    diagnostics.pricingModifierResponses += result.diagnostics.pricingModifierResponses
    diagnostics.serverToolRequests += result.diagnostics.serverToolRequests
    if (!result.summary) continue
    summaries.push(result.summary)
    entries.push(...result.entries)
    for (const [day, activity] of result.activityByDay) {
      const existing = childActivityByDay.get(day)
      childActivityByDay.set(
        day,
        existing
          ? {
              user: existing.user + activity.user,
              assistant: existing.assistant + activity.assistant,
            }
          : { user: activity.user, assistant: activity.assistant }
      )
    }
  }
  return { summaries, entries, childActivityByDay, diagnostics }
}

async function parseSingleSubagent(
  filePath: string,
  fileName: string,
  sessionId: string,
  projectId: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<{
  summary: SubagentSummary | null
  entries: ResponseEntry[]
  activityByDay: Map<string, DayActivity>
  diagnostics: SubagentDiagnostics
}> {
  const agentId = fileName.replace(/^agent-/, '').replace(/\.jsonl$/, '')
  const source: SourceIdentity = { kind: 'subagent', projectId, sessionId, agentId }
  const accumulator = createResponseAccumulator(filePath, source, pricingTable)

  // Message counts come from the same response-grouping the ledger uses for
  // usage, so a block-split child response counts once for both.
  const activity = createActivityAccumulator()
  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined
  let malformedLines = 0

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.trim()) continue
      let raw: RawRecord
      try {
        raw = JSON.parse(line) as RawRecord
      } catch {
        malformedLines++
        continue
      }

      if (!firstTimestamp && raw.timestamp) firstTimestamp = raw.timestamp
      if (raw.timestamp) lastTimestamp = raw.timestamp

      activity.add(raw)
      accumulator.add(raw)
    }
  } catch {
    // The file exists (it came from `readdir`) but could not be read — a
    // distinct failure from "no subagents directory" above: there really was
    // a child here, and its usage is now missing from the rollup unless this
    // is counted rather than treated the same as a session with none at all.
    return {
      summary: null,
      entries: [],
      activityByDay: new Map(),
      diagnostics: {
        malformedLines,
        unreadableChildren: 1,
        negativeCounters: 0,
        conflictCount: 0,
        unpricedResponses: 0,
        incompleteUsageResponses: 0,
        responsesWithoutCompletionSignal: 0,
        reducedConfidenceResponses: 0,
        pricingModifierResponses: 0,
        serverToolRequests: 0,
      },
    }
  }

  const activityCounts = activity.counts()
  // Computed before `diagnostics` (unlike the pre-widening version of this
  // function) so the four usage-completeness fields below can read off the
  // same projection the summary itself is built from, rather than being
  // filled in as zero and never revisited.
  const entries = accumulator.entries()
  const usage = projectUsage(entries)
  const diagnostics: SubagentDiagnostics = {
    malformedLines,
    unreadableChildren: 0,
    negativeCounters: accumulator.negativeCounters(),
    conflictCount: usage.conflictCount,
    unpricedResponses: usage.combined.unpricedResponses,
    incompleteUsageResponses: usage.combined.incompleteUsageResponses,
    responsesWithoutCompletionSignal: usage.combined.responsesWithoutCompletionSignal,
    reducedConfidenceResponses: usage.combined.reducedConfidenceResponses,
    pricingModifierResponses: usage.combined.pricingModifierResponses,
    serverToolRequests: usage.combined.serverToolRequests,
  }
  if (activityCounts.total === 0) {
    return { summary: null, entries: [], activityByDay: new Map(), diagnostics }
  }

  return {
    summary: {
      agentId,
      messageCount: activityCounts.total,
      totalInputTokens: usage.combined.inputTokens,
      totalOutputTokens: usage.combined.outputTokens,
      primaryModel: usage.modelBreakdown[0]?.model,
      firstTimestamp: firstTimestamp ?? '',
      lastTimestamp: lastTimestamp ?? '',
      estimatedCost: usage.combined.estimatedCost,
      modelBreakdown: usage.modelBreakdown.map((m) => ({
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheCreation5mTokens: m.cacheWrite5m,
        cacheCreation1hTokens: m.cacheWrite1h,
        cacheCreationUnknownTtlTokens: m.cacheWriteUnknownTtl,
        estimatedCost: m.estimatedCost ?? 0,
        turnCount: m.turnCount,
      })),
    },
    entries,
    activityByDay: activityCounts.byDay,
    diagnostics,
  }
}
