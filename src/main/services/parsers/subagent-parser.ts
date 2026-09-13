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
import { isSyntheticAssistant, isToolResultCarrierUser } from './parser-helpers'

export interface SubagentParseResult {
  summaries: SubagentSummary[]
  /** Ledger entries for every subagent, for rollup into the parent session. */
  entries: ResponseEntry[]
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
    return { summaries: [], entries: [] }
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
  for (const result of parsed) {
    if (!result) continue
    summaries.push(result.summary)
    entries.push(...result.entries)
  }
  return { summaries, entries }
}

async function parseSingleSubagent(
  filePath: string,
  fileName: string,
  sessionId: string,
  projectId: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<{ summary: SubagentSummary; entries: ResponseEntry[] } | null> {
  const agentId = fileName.replace(/^agent-/, '').replace(/\.jsonl$/, '')
  const source: SourceIdentity = { kind: 'subagent', projectId, sessionId, agentId }
  const accumulator = createResponseAccumulator(filePath, source, pricingTable)

  let messageCount = 0
  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined

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
        continue
      }

      if (!firstTimestamp && raw.timestamp) firstTimestamp = raw.timestamp
      if (raw.timestamp) lastTimestamp = raw.timestamp

      if (raw.type === 'user' && !isToolResultCarrierUser(raw)) messageCount++
      if (raw.type === 'assistant' && !isSyntheticAssistant(raw)) messageCount++

      accumulator.add(raw)
    }
  } catch {
    return null
  }

  if (messageCount === 0) return null

  const entries = accumulator.entries()
  const usage = projectUsage(entries)

  return {
    summary: {
      agentId,
      messageCount,
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
        estimatedCost: m.estimatedCost ?? 0,
        turnCount: m.turnCount,
      })),
    },
    entries,
  }
}
